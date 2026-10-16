import {readFile,writeFile,readdir,mkdir,cp,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {availableParallelism} from 'node:os';
import {digest} from './wasmbench.mjs';
import {instrumentWamrNativeSize} from './wamr-native-size.mjs';
import {configureCMakeSource} from './cmake-source.mjs';
import {privateGlibcLinkFlags} from './private-glibc-link.mjs';
export async function wamrArchitectureUnavailable(source,configuration,arch=process.arch) {
 if(configuration!=='wamr-fast-jit'||arch==='x64')return null;
 const path=join(source,'core/iwasm/fast-jit/iwasm_fast_jit.cmake'),text=await readFile(path,'utf8');
 if(text.includes('Fast JIT codegen for target ${WAMR_BUILD_TARGET}')&&text.includes("isn't implemented")&&/WAMR_BUILD_TARGET STREQUAL "X86_64"/.test(text)&&!/WAMR_BUILD_TARGET (?:MATCHES|STREQUAL) "(?:AARCH64|ARM)/.test(text))return {reason:'Pinned WAMR Fast JIT only implements x86-64 code generation; '+arch+' is unsupported',proofFile:path,proofSha256:digest(Buffer.from(text))};
 throw Error('WAMR architecture policy changed; inspect the pinned Fast JIT build rules');
}
export function wamrBuildFlags(configuration,llvmDirectory,featureProposals=false) {
 const singleThread='-DWASM_ORC_JIT_BACKEND_THREAD_NUM=1 -DWASM_ORC_JIT_COMPILE_THREAD_NUM=1';
 const flags=['-DCMAKE_BUILD_TYPE=Release','-DCMAKE_C_FLAGS='+singleThread,'-DCMAKE_CXX_FLAGS='+singleThread,'-DWAMR_BUILD_INTERP=1','-DWAMR_BUILD_AOT=0','-DWAMR_DISABLE_STACK_HW_BOUND_CHECK=1','-DWAMR_BUILD_FAST_INTERP='+(configuration==='wamr'?'1':'0'),'-DWAMR_BUILD_GC=1','-DWAMR_BUILD_EXCE_HANDLING=0','-DWAMR_BUILD_LIBC_WASI=0','-DWAMR_BUILD_LIBC_BUILTIN=0','-DBUILD_SHARED_LIBS=ON','-DWAMR_BUILD_LAZY_JIT=0'];
 if(configuration==='wamr-fast-jit')flags.push('-DWAMR_BUILD_FAST_JIT=1','-DWAMR_BUILD_JIT=0','-DWAMR_BUILD_GC=0','-DWAMR_BUILD_EXCE_HANDLING=0','-DWAMR_BUILD_SIMD=0');
 else if(configuration==='wamr-llvm-jit'){if(!llvmDirectory)throw Error('WAMR LLVM JIT requires an explicit LLVM SDK');flags.push('-DWAMR_BUILD_JIT=1','-DWAMR_BUILD_FAST_JIT=0','-DLLVM_DIR='+llvmDirectory);}
 else if(configuration==='wamr')flags.push('-DWAMR_BUILD_JIT=0','-DWAMR_BUILD_FAST_JIT=0');
 else throw Error('Unknown WAMR configuration '+configuration);
 if(featureProposals)flags.push('-DWAMR_BUILD_TAIL_CALL=1','-DWAMR_BUILD_EXTENDED_CONST_EXPR=1');
 return flags;
}
export function wamrLLVMCompilerFlags(prefix,env={},platform=process.platform) {
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 const library=join(prefix,'lib/x86_64-unknown-linux-gnu');
 const singleThread='-DWASM_ORC_JIT_BACKEND_THREAD_NUM=1 -DWASM_ORC_JIT_COMPILE_THREAD_NUM=1';
 const link=['-fuse-ld='+quote(join(prefix,'bin/ld.lld')),'-L'+quote(library),quote('-Wl,-rpath,'+library),...privateGlibcLinkFlags(env,platform)].join(' ');
 return ['-DCMAKE_C_COMPILER='+join(prefix,'bin/clang'),'-DCMAKE_CXX_COMPILER='+join(prefix,'bin/clang++'),
  '-DCMAKE_CXX_FLAGS='+singleThread+' -stdlib=libc++ -nostdinc++ -isystem '+quote(join(prefix,'include/c++/v1')),
  '-DCMAKE_EXE_LINKER_FLAGS='+link,'-DCMAKE_SHARED_LINKER_FLAGS='+link];
}
/** Honor distro LLVM's shared-link mode instead of linking optional tool/GPU libraries. */
export async function configureWamrLLVMSharedLink(source,configuration) {
 if(configuration!=='wamr-llvm-jit')return null;
 const path=join(source,'product-mini/platforms',process.platform,'CMakeLists.txt');
 const before=await readFile(path,'utf8');
 const marker='# wasm.fyi: honor the LLVM package shared-link configuration';
 if(before.includes(marker))return {path,sha256:digest(Buffer.from(before))};
 const link=/target_link_libraries\s*\(\s*vmlib\s+\$\{LLVM_AVAILABLE_LIBS\}/;
 if(!link.test(before))return null;
 const guard=marker+'\nif (LLVM_LINK_LLVM_DYLIB AND TARGET LLVM)\n  set (LLVM_AVAILABLE_LIBS LLVM)\nendif ()\n\n';
 const after=before.replace(link,match=>guard+match);
 await writeFile(path,after);
 return {path,originalSha256:digest(Buffer.from(before)),sha256:digest(Buffer.from(after))};
}
export async function buildWamrSDK({source,sdk,target,configuration,version,env,run}) {
 const unavailable=await wamrArchitectureUnavailable(source,configuration);
 if(unavailable){const error=Error(unavailable.reason);error.code='UNSUPPORTED_PLATFORM';error.proof=unavailable;throw error;}
 let llvmDirectory=env.LLVM_DIR;
 if(configuration==='wamr-llvm-jit'&&!llvmDirectory){for(const prefix of ['/opt/homebrew/opt/llvm@18','/usr/lib/llvm-18'])if(await stat(join(prefix,'lib/cmake/llvm/LLVMConfig.cmake')).catch(()=>null)){llvmDirectory=join(prefix,'lib/cmake/llvm');break;}}
 const flags=wamrBuildFlags(configuration,llvmDirectory,env.WASMFYI_WAMR_FEATURE_PROPOSALS==='1');
 // Reuse CMake's pinned FetchContent checkouts across SDKs built under the same host lock.
 if(env.WASMFYI_WAMR_CMAKE_CACHE)flags.push('-DFETCHCONTENT_BASE_DIR='+resolve(env.WASMFYI_WAMR_CMAKE_CACHE));
 // Official Linux LLVM archives use libc++, including their C++ API ABI.
 // Keep compiler, headers, library ABI and bitcode-capable linker together.
 const compilerPrefix=configuration==='wamr-llvm-jit'&&process.platform==='linux'?(env.WASMFYI_WAMR_CXX_SDK||env.WASMFYI_WAVM_CXX_SDK):null;
 if(compilerPrefix){
  for(const file of ['bin/clang','bin/clang++','bin/ld.lld','include/c++/v1/vector'])if(!await stat(join(compilerPrefix,file)).catch(()=>null))throw Error('WAMR LLVM compiler SDK lacks '+file);
  flags.push(...wamrLLVMCompilerFlags(resolve(compilerPrefix),env));
 }
 const measurementPatch=await instrumentWamrNativeSize(source,configuration);
 const llvmLinkPatch=await configureWamrLLVMSharedLink(source,configuration);
 await configureCMakeSource({source:join(source,'product-mini/platforms',process.platform),target,flags,run});
 await run('cmake',['--build',target,'--target','vmlib','-j',String(env.WASMFYI_BUILD_JOBS||availableParallelism())]);
 await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
 for(const name of await readdir(join(source,'core/iwasm/include')))if(name.endsWith('.h'))await cp(join(source,'core/iwasm/include',name),join(sdk,'include',name));
 const libraries=(await readdir(target)).filter(name=>/^libiwasm.*\.(?:dylib|so)(?:\.[\d.]+)?$/.test(name));
 if(!libraries.length)throw Error('WAMR source build produced no shared runtime library');
 for(const name of libraries)await cp(join(target,name),join(sdk,'lib',name),{dereference:true});
 const linkerName=process.platform==='darwin'?'libiwasm.dylib':'libiwasm.so';
 if(!await stat(join(sdk,'lib',linkerName)).catch(()=>null))await cp(join(target,libraries[0]),join(sdk,'lib',linkerName),{dereference:true});
 env.WASMBENCH_WAMR_SDK=sdk;env.WASMBENCH_WAMR_VERSION=version;
 return {sdk,source,configuration,version,flags,compilerPrefix,measurementPatch,llvmLinkPatch,libraries:await Promise.all(libraries.map(async name=>({name,sha256:digest(await readFile(join(sdk,'lib',name)))})))};
}
