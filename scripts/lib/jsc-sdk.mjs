import {mkdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {digest} from './wasmbench.mjs';
import {prepareJavaScriptCoreNativeSize} from './jsc-native-size.mjs';

export function javaScriptCorePort(common,mac) {
 const ports=common.match(/set\(ALL_PORTS\s+([^)]*)\)/)?.[1].trim().split(/\s+/);
 const port=mac?(ports?.includes('Cocoa')?'Cocoa':'Mac'):'JSCOnly';
 if(!ports?.includes(port))throw Error('Pinned WebKit source does not support '+port);
 return port;
}

export async function buildJavaScriptCoreSDK({source,target,revision,env,run}) {
 if(!['darwin-arm64','linux-x64'].includes(process.platform+'-'+process.arch))throw Error('Unqualified JavaScriptCore source-build platform');
 await mkdir(target,{recursive:true});
 const measurement=await prepareJavaScriptCoreNativeSize({source,target:join(target,'native-source'),run});
 source=measurement.source;target=join(target,'native-build');
 await mkdir(target,{recursive:true});
 const mac=process.platform==='darwin';
 // New WebKit revisions renamed the Mac CMake port to Cocoa. Use its actual
 // name so incremental configure preserves the upstream build identity.
 const port=javaScriptCorePort(await readFile(join(source,'Source/cmake/WebKitCommon.cmake'),'utf8'),mac);
 const flags=['-S',source,'-B',target,'-G','Ninja','-DPORT='+port,'-DCMAKE_BUILD_TYPE=Release','-DENABLE_API_TESTS=OFF'];
 const localNinja=join(homedir(),'.cache/wasm-fyi/toolchains/ninja-local/usr/bin/ninja');
 if(!mac&&await stat(localNinja).catch(()=>null))flags.push('-DCMAKE_MAKE_PROGRAM='+localNinja);
 if(mac){
  const sdk=(await run('xcrun',['--sdk','macosx','--show-sdk-path'])).output.trim();
  flags.push('-DCMAKE_OSX_SYSROOT='+sdk,'-DCMAKE_OSX_ARCHITECTURES=arm64','-DENABLE_WEBKIT=OFF','-DENABLE_WEBKIT_LEGACY=OFF','-DENABLE_WEBKIT_TEST_RUNNER=OFF','-DENABLE_MINIBROWSER=OFF','-DENABLE_SWIFTBROWSER=OFF','-DENABLE_LLDB_WEBKIT_TESTER=OFF','-DENABLE_JAVASCRIPTCORE=ON');
 }else flags.push('-DCMAKE_CXX_FLAGS=-Wno-error=unused-const-variable');
 const buildEnv={...env},ruby=join(homedir(),'.cache/wasm-fyi/toolchains/ruby-3.2-local');
 if(!mac&&await stat(join(ruby,'bin/ruby')).catch(()=>null)){
  buildEnv.PATH=join(ruby,'bin')+':'+buildEnv.PATH;
  buildEnv.LD_LIBRARY_PATH=[join(ruby,'root/usr/lib/x86_64-linux-gnu'),buildEnv.LD_LIBRARY_PATH].filter(Boolean).join(':');
  buildEnv.RUBYLIB=[join(ruby,'root/usr/lib/ruby/3.2.0'),join(ruby,'root/usr/lib/x86_64-linux-gnu/ruby/3.2.0'),buildEnv.RUBYLIB].filter(Boolean).join(':');
 }
 await run('cmake',flags,{cwd:source,env:buildEnv});
 await run('cmake',['--build',target,'--target','jsc','-j','2'],{cwd:source,env:buildEnv});
 const binary=join(target,mac?'jsc':'bin/jsc');
 if(!await stat(binary).catch(()=>null))throw Error('JavaScriptCore source build did not produce its shell');
 if(mac){
  const relative='JavaScriptCore.framework/Versions/A/JavaScriptCore',library=join(target,relative),installName='@rpath/'+relative;
  const linked=(await run('otool',['-L',binary])).output;
  const old=linked.split('\n').map(line=>line.trim().split(' (')[0]).find(path=>path.endsWith('/'+relative));
  if(!old)throw Error('Source shell has no JavaScriptCore framework dependency');
  await run('install_name_tool',['-id',installName,library]);
  if(old!==installName)await run('install_name_tool',['-change',old,installName,binary]);
  const commands=(await run('otool',['-l',binary])).output;
  if(!/path @loader_path \(offset/.test(commands))await run('install_name_tool',['-add_rpath','@loader_path',binary]);
  await run('codesign',['--force','--sign','-',library]);
  await run('codesign',['--force','--sign','-',binary]);
  // Protected macOS launchers strip DYLD overrides. Bind the source framework
  // in the executable itself so taskpolicy cannot select the system engine.
  env.DYLD_FRAMEWORK_PATH='';
 }
 // A prior system-framework host must not override the selected source shell.
 env.WASMBENCH_JSC_HOST='';
 env.WASMBENCH_JSC=binary;env.WASMBENCH_JSC_VERSION=revision;
 await run(binary,['-e','if(typeof WebAssembly!=="object"||!WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0])))throw Error("WebAssembly unavailable")']);
 await run(binary,['-e','if(typeof wasmFyiNativeCodeSize!=="function")throw Error("Native code measurement ABI missing")']);
 const calibration='const m=new WebAssembly.Module(Uint8Array.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,8,1,4,116,101,115,116,0,0,10,6,1,4,0,65,42,11]));const f=new WebAssembly.Instance(m).exports.test;for(let i=0;i<100000;i++)if(f()!==42)throw Error("incorrect calibration");';
 const tierFlags=['--validateOptions=true','--thresholdForBBQOptimizeAfterWarmUp=1','--thresholdForBBQOptimizeSoon=1','--thresholdForOMGOptimizeAfterWarmUp=1','--thresholdForOMGOptimizeSoon=1','--useConcurrentJIT=false','--numberOfWasmCompilerThreads=0','--useConcurrentGC=false','--numberOfGCMarkers=1','--useParallelMarkingConstraintSolver=false','--dumpOMGDisassembly=true'];
 const tier=(await run(binary,[...tierFlags,'-e',calibration])).output;
 if(!tier.includes('Generated OMG'))throw Error('Pinned JSC SDK did not prove OMG compilation');
 return {source,target,binary,binarySha256:digest(await readFile(binary)),flags,revision,measurement,tierProbe:{backend:'OMG',outputSha256:digest(Buffer.from(tier)),flags:tierFlags,scope:'Separate build qualification; disassembly disabled during benchmark measurements'}};
}
