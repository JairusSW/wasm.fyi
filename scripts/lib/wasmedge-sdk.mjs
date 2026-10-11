import {readFile,readdir,mkdir,cp,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir,availableParallelism} from 'node:os';
import {configureCMakeSource} from './cmake-source.mjs';
import {privateGlibcLinkFlags} from './private-glibc-link.mjs';
import {instrumentWasmEdgeJIT} from './wasmedge-jit-bridge.mjs';
import {digest} from './wasmbench.mjs';
export function wasmEdgeHostLinkFlags(env,platform=process.platform) {
 if(platform!=='linux')return [];
 const prefix=env.WASMFYI_WASMEDGE_CXX_SDK||env.WASMFYI_WAVM_CXX_SDK;
 // The upstream version script also lists optional/removed C API exports.
 // Permit those labels only, while requiring every actual import to resolve.
 const linker=['-Wl,--undefined-version','-Wl,--no-undefined'];
 const flags=[];
 if(prefix){
  if(!prefix.startsWith('/')||/[\s"'`$]/.test(prefix))throw Error('Unsafe WasmEdge compiler SDK prefix');
  const library=join(prefix,'lib/x86_64-unknown-linux-gnu');
  flags.push('-DCMAKE_C_COMPILER='+join(prefix,'bin/clang'),'-DCMAKE_CXX_COMPILER='+join(prefix,'bin/clang++'),'-DCMAKE_CXX_FLAGS=-stdlib=libc++ -nostdinc++ -I'+join(prefix,'include/c++/v1'));
  linker.push('-L'+library,'-Wl,-rpath,'+library,'-fuse-ld='+join(prefix,'bin/ld.lld'));
 }
 linker.push(...privateGlibcLinkFlags(env,platform));
 flags.push('-DCMAKE_SHARED_LINKER_FLAGS='+linker.join(' '));
 if(env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR){
  // CMake compiler probes are executables too. Bind their libc and loader to
  // the same qualified family instead of the host's implicit linker script.
  const loader=join(env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR,'ld-linux-x86-64.so.2');
  const executable=linker.filter(flag=>flag!=='-Wl,--undefined-version');
  executable.push('-Wl,--no-as-needed',loader,'-Wl,--as-needed','-Wl,--dynamic-linker,'+loader);
  flags.push('-DCMAKE_EXE_LINKER_FLAGS='+executable.join(' '));
 }
 return flags;
}
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
 flags.push(...wasmEdgeHostLinkFlags(env));
 await configureCMakeSource({source,target,flags,run});
 await run('cmake',['--build',target,'--target','wasmedge_shared','-j',String(env.WASMFYI_BUILD_JOBS||availableParallelism())]);
 await mkdir(join(sdk,'include/wasmedge'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
 // Configured enum/version headers accompany the source C API header.
 for(const directory of [join(source,'include/api/wasmedge'),join(target,'include/api/wasmedge')])for(const name of await readdir(directory).catch(()=>[]))if(/\.(?:h|inc)$/.test(name))await cp(join(directory,name),join(sdk,'include/wasmedge',name));
 const libraryDir=join(target,'lib/api'),libraries=(await readdir(libraryDir)).filter(name=>/^libwasmedge.*\.(?:so|dylib)(?:\.[\d.]+)?$/.test(name));
 if(!libraries.length)throw Error('WasmEdge build did not produce its shared library');
 for(const name of libraries)await cp(join(libraryDir,name),join(sdk,'lib',name),{dereference:true});
 env.WASMBENCH_WASMEDGE_SDK=sdk;
 return {sdk,source,configuration,flags,measurementPatch,libraries:await Promise.all(libraries.map(async name=>({name,sha256:digest(await readFile(join(sdk,'lib',name)))})))};
}
