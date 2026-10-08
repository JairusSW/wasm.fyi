import {readFile,readdir,mkdir,cp,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {instrumentWasmEdgeJIT} from './wasmedge-jit-bridge.mjs';
import {digest} from './wasmbench.mjs';
export async function wasmedgeJITUnavailable(source,configuration) {
 if(configuration!=='wasmedge-jit')return null;
 const directory=join(source,'include/api/wasmedge');
 const names=(await readdir(directory)).filter(name=>name.endsWith('.h'));
 const files=await Promise.all(names.map(async name=>({name,text:await readFile(join(directory,name),'utf8')})));
 if(files.some(file=>file.text.includes('WasmEdge_ConfigureSetRunMode')))return null;
 if(!files.some(file=>file.text.includes('WasmEdge_ConfigureCreate')))throw Error('Pinned WasmEdge C API layout changed');
 const enumeration=await readFile(join(source,'include/common/enum.inc'),'utf8');
 if(/^R\(JIT\)/m.test(enumeration))throw Error('Pinned SDK has internal JIT support but requires an additional C API binding');
 return {enumSha256:digest(Buffer.from(enumeration)),reason:'This pinned WasmEdge SDK has no JIT run mode; its ahead-of-time compiler is not a JIT backend.',configuration,headers:Object.fromEntries(files.map(file=>[file.name,digest(Buffer.from(file.text))]))};
}
export async function buildWasmEdgeSDK({source,sdk,target,configuration,env,run}) {
 const unavailable=await wasmedgeJITUnavailable(source,configuration);
 if(unavailable){const error=Error(unavailable.reason);error.code='UNSUPPORTED_BACKEND';error.proof=unavailable;throw error;}
 const jit=configuration==='wasmedge-jit';
 if(!['wasmedge','wasmedge-jit'].includes(configuration))throw Error('Unknown WasmEdge configuration');
 let llvmDirectory=env.LLVM_DIR;
 if(jit&&!llvmDirectory)for(const prefix of ['/opt/homebrew/opt/llvm@18','/usr/lib/llvm-18'])if(await stat(join(prefix,'lib/cmake/llvm/LLVMConfig.cmake')).catch(()=>null)){llvmDirectory=join(prefix,'lib/cmake/llvm');break;}
 if(jit&&!llvmDirectory)throw Error('WasmEdge JIT requires a qualified LLVM SDK');
 const measurementPatch=jit?await instrumentWasmEdgeJIT(source):null;
 const dependencyPrefix=join(homedir(),'.cache/wasm-fyi/toolchains/lld-18/usr');
 const dependencyFlags=await stat(dependencyPrefix).catch(()=>null)?['-DCMAKE_PREFIX_PATH='+dependencyPrefix]:[];
 const flags=[...dependencyFlags,'-DCMAKE_BUILD_TYPE=Release','-DWASMEDGE_BUILD_TESTS=OFF','-DWASMEDGE_BUILD_TOOLS=OFF','-DWASMEDGE_BUILD_PLUGINS=OFF','-DWASMEDGE_BUILD_SHARED_LIB=ON','-DWASMEDGE_BUILD_STATIC_LIB=OFF','-DWASMEDGE_USE_LLVM='+(jit?'ON':'OFF'),'-DCMAKE_INSTALL_PREFIX='+sdk];
 if(jit){flags.push('-DLLVM_DIR='+llvmDirectory);
  const prefixes=[env.LLD_DIR,join(homedir(),'.cache/wasm-fyi/toolchains/lld-18/usr/lib/llvm-18/lib/cmake/lld'),'/usr/lib/llvm-18/lib/cmake/lld','/opt/homebrew/opt/llvm@18/lib/cmake/lld'].filter(Boolean);
  for(const directory of prefixes)if(await stat(join(directory,'LLDConfig.cmake')).catch(()=>null)){flags.push('-DLLD_DIR='+directory);break;}
 }
 await run('cmake',['-S',source,'-B',target,...flags]);
 await run('cmake',['--build',target,'--target','wasmedge_shared','-j','2']);
 await mkdir(join(sdk,'include/wasmedge'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
 // Configured enum/version headers accompany the source C API header.
 for(const directory of [join(source,'include/api/wasmedge'),join(target,'include/api/wasmedge')])for(const name of await readdir(directory).catch(()=>[]))if(/\.(?:h|inc)$/.test(name))await cp(join(directory,name),join(sdk,'include/wasmedge',name));
 const libraryDir=join(target,'lib/api'),libraries=(await readdir(libraryDir)).filter(name=>/^libwasmedge.*\.(?:so|dylib)(?:\.[\d.]+)?$/.test(name));
 if(!libraries.length)throw Error('WasmEdge build did not produce its shared library');
 for(const name of libraries)await cp(join(libraryDir,name),join(sdk,'lib',name),{dereference:true});
 env.WASMBENCH_WASMEDGE_SDK=sdk;
 return {sdk,source,configuration,flags,measurementPatch,libraries:await Promise.all(libraries.map(async name=>({name,sha256:digest(await readFile(join(sdk,'lib',name)))})))};
}
