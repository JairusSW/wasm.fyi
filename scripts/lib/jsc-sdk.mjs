import {mkdir,readFile,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir,availableParallelism} from 'node:os';
import {digest} from './wasmbench.mjs';
import {prepareJavaScriptCoreNativeSize} from './jsc-native-size.mjs';
import {configureCMakeSource} from './cmake-source.mjs';
import {javaScriptCoreBuildPython,javaScriptCorePythonFlags} from './jsc-build-python.mjs';
import {privateGlibcLinkFlags} from './private-glibc-link.mjs';

export function javaScriptCorePort(common,mac) {
 const ports=common.match(/set\(ALL_PORTS\s+([^)]*)\)/)?.[1].trim().split(/\s+/);
 const port=mac?(ports?.includes('Cocoa')?'Cocoa':'Mac'):'JSCOnly';
 if(!ports?.includes(port))throw Error('Pinned WebKit source does not support '+port);
 return port;
}
export function javaScriptCoreCompilerFlags(prefix) {
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 const library=join(prefix,'lib/x86_64-unknown-linux-gnu');
 const linker='-fuse-ld='+quote(join(prefix,'bin/ld.lld'))+' -L'+quote(library)+' '+quote('-Wl,-rpath,'+library);
 return ['-DCMAKE_C_COMPILER='+join(prefix,'bin/clang'),'-DCMAKE_CXX_COMPILER='+join(prefix,'bin/clang++'),
  '-DCMAKE_CXX_FLAGS=-stdlib=libc++ -nostdinc++ -isystem '+quote(join(prefix,'include/c++/v1'))+' -Wno-error=unused-const-variable -Wno-error=unused-command-line-argument',
  '-DCMAKE_EXE_LINKER_FLAGS='+linker,'-DCMAKE_SHARED_LINKER_FLAGS='+linker];
}
export function javaScriptCoreICUFlags(prefix){
 return ['-DICU_ROOT='+prefix,'-DICU_INCLUDE_DIR='+join(prefix,'include'),...['uc','i18n','data'].map(name=>'-DICU_'+name.toUpperCase()+'_LIBRARY_RELEASE='+join(prefix,'lib/x86_64-linux-gnu','libicu'+name+'.so'))];
}
export function verifyJavaScriptCoreICUBindings(cache,prefix){
 const values=new Map(cache.split('\n').flatMap(line=>{const m=line.match(/^([^:#]+):[^=]+=(.*)$/);return m?[[m[1],m[2]]]:[]}));
 for(const flag of javaScriptCoreICUFlags(prefix).slice(1)){
  const split=flag.indexOf('='),key=flag.slice(2,split),expected=flag.slice(split+1);
  if(values.get(key)!==expected)throw Error('JavaScriptCore ICU binding differs for '+key+': '+values.get(key));
 }
}
export function javaScriptCoreRuntimeLinkFlags(flags,env,platform=process.platform){
 const runtime=privateGlibcLinkFlags(env,platform);
 if(!runtime.length)return flags;
 const loader=join(env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR,'ld-linux-x86-64.so.2');
 const dlDirectory=env.WASMFYI_JSC_DL_LINK_DIR;
 if(dlDirectory&&(!dlDirectory.startsWith('/')||/[\s"'`$]/.test(dlDirectory)))throw Error('Unsafe JavaScriptCore dl compatibility directory');
 const linked=['EXE','SHARED','MODULE'].reduce((result,kind)=>{
  const key='-DCMAKE_'+kind+'_LINKER_FLAGS=';
  const previous=result.findLast(flag=>flag.startsWith(key))?.slice(key.length)||'';
  // The compiler's implicit system libc linker script also names its loader.
  // Bind our matching loader explicitly before that script can select another.
  const extra=[...runtime,...(kind==='EXE'?['-Wl,--no-as-needed',loader,'-Wl,--as-needed','-Wl,--dynamic-linker,'+loader]:[])].join(' ');
  return [...result.filter(flag=>!flag.startsWith(key)),key+[dlDirectory?'-L'+dlDirectory:'',previous,extra].filter(Boolean).join(' ')];
 },flags);
 const include=join(dirname(dirname(env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR)),'include');
 // FindThreads may retain the old host libc result and keep linking its
 // pthread DLL. Recheck that capability against the selected runtime instead.
 return ['C','CXX'].reduce((result,language)=>{
  const key='-DCMAKE_'+language+'_FLAGS=';
  const previous=result.findLast(flag=>flag.startsWith(key))?.slice(key.length)||'';
  return [...result.filter(flag=>!flag.startsWith(key)),key+[previous,'-isystem '+join(include,'x86_64-linux-gnu')+' -isystem '+include].filter(Boolean).join(' ')];
 },[...linked,...['CMAKE_HAVE_LIBC_PTHREAD','CMAKE_HAVE_PTHREADS_CREATE','CMAKE_HAVE_PTHREAD_CREATE','CMAKE_THREAD_LIBS_INIT'].map(key=>'-U'+key)]);
}

export async function buildJavaScriptCoreSDK({source,target,revision,env,run}) {
 if(!['darwin-arm64','linux-x64'].includes(process.platform+'-'+process.arch))throw Error('Unqualified JavaScriptCore source-build platform');
 await mkdir(target,{recursive:true});
 const measurement=await prepareJavaScriptCoreNativeSize({source,target:join(target,'native-source'),run,sparse:env.WASMFYI_JSC_SPARSE_MEASUREMENT==='1'});
 source=measurement.source;target=join(target,'native-build');
 await mkdir(target,{recursive:true});
 const mac=process.platform==='darwin';
 // New WebKit revisions renamed the Mac CMake port to Cocoa. Use its actual
 // name so incremental configure preserves the upstream build identity.
 const port=javaScriptCorePort(await readFile(join(source,'Source/cmake/WebKitCommon.cmake'),'utf8'),mac);
 let flags=['-S',source,'-B',target,'-G','Ninja','-DPORT='+port,'-DCMAKE_BUILD_TYPE=Release','-DENABLE_API_TESTS=OFF'];
 const localNinja=join(homedir(),'.cache/wasm-fyi/toolchains/ninja-local/usr/bin/ninja');
 if(!mac&&await stat(localNinja).catch(()=>null))flags.push('-DCMAKE_MAKE_PROGRAM='+localNinja);
 if(mac){
  const sdk=(await run('xcrun',['--sdk','macosx','--show-sdk-path'])).output.trim();
  flags.push('-DCMAKE_OSX_SYSROOT='+sdk,'-DCMAKE_OSX_ARCHITECTURES=arm64','-DENABLE_WEBKIT=OFF','-DENABLE_WEBKIT_LEGACY=OFF','-DENABLE_WEBKIT_TEST_RUNNER=OFF','-DENABLE_MINIBROWSER=OFF','-DENABLE_SWIFTBROWSER=OFF','-DENABLE_LLDB_WEBKIT_TESTER=OFF','-DENABLE_JAVASCRIPTCORE=ON');
 }else {
  const icuSDK=env.WASMFYI_JSC_ICU_SDK;
  if(icuSDK){
   for(const file of ['include/unicode/uvernum.h',...['uc','i18n','data'].map(name=>'lib/x86_64-linux-gnu/libicu'+name+'.so')])if(!await stat(join(icuSDK,file)).catch(()=>null))throw Error('JavaScriptCore ICU SDK lacks '+file);
   flags.push(...javaScriptCoreICUFlags(icuSDK));
  }
  const compilerSDK=env.WASMFYI_JSC_CXX_SDK||env.WASMFYI_WAVM_CXX_SDK;
  if(compilerSDK){
   for(const file of ['bin/clang','bin/clang++','bin/ld.lld','include/c++/v1/vector'])if(!await stat(join(compilerSDK,file)).catch(()=>null))throw Error('JavaScriptCore compiler SDK lacks '+file);
   flags.push(...javaScriptCoreCompilerFlags(compilerSDK));
  }else flags.push('-DCMAKE_CXX_FLAGS=-Wno-error=unused-const-variable');
 }
 if(!mac&&env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR){
  for(const file of ['libc.so.6','ld-linux-x86-64.so.2'])if(!await stat(join(env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR,file)).catch(()=>null))throw Error('JavaScriptCore private runtime lacks '+file);
  const include=join(dirname(dirname(env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR)),'include');
  for(const file of ['stdint.h','x86_64-linux-gnu/bits/stdint-least.h','x86_64-linux-gnu/gnu/stubs-64.h'])if(!await stat(join(include,file)).catch(()=>null))throw Error('JavaScriptCore private runtime headers lack '+file);
  flags=javaScriptCoreRuntimeLinkFlags(flags,env);
 }
 const buildEnv={...env},ruby=join(homedir(),'.cache/wasm-fyi/toolchains/ruby-3.2-local');
 const python=await javaScriptCoreBuildPython(env,run);
 flags.push(...javaScriptCorePythonFlags(python.program));
 if(python.program.startsWith('/'))buildEnv.PATH=dirname(python.program)+':'+buildEnv.PATH;
 if(!mac&&await stat(join(ruby,'bin/ruby')).catch(()=>null)){
  buildEnv.PATH=join(ruby,'bin')+':'+buildEnv.PATH;
  buildEnv.LD_LIBRARY_PATH=[join(ruby,'root/usr/lib/x86_64-linux-gnu'),buildEnv.LD_LIBRARY_PATH].filter(Boolean).join(':');
  buildEnv.RUBYLIB=[join(ruby,'root/usr/lib/ruby/3.2.0'),join(ruby,'root/usr/lib/x86_64-linux-gnu/ruby/3.2.0'),buildEnv.RUBYLIB].filter(Boolean).join(':');
 }
 await configureCMakeSource({source,target,flags:flags.slice(4),run,options:{cwd:source,env:buildEnv}});
 if(!mac&&env.WASMFYI_JSC_ICU_SDK)verifyJavaScriptCoreICUBindings(await readFile(join(target,'CMakeCache.txt'),'utf8'),env.WASMFYI_JSC_ICU_SDK);
 await run('cmake',['--build',target,'--target','jsc','-j',String(env.WASMFYI_BUILD_JOBS||availableParallelism())],{cwd:source,env:buildEnv});
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
 return {source,target,binary,binarySha256:digest(await readFile(binary)),flags,revision,python,measurement,tierProbe:{backend:'OMG',outputSha256:digest(Buffer.from(tier)),flags:tierFlags,scope:'Separate build qualification; disassembly disabled during benchmark measurements'}};
}
