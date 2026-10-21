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
export function wamrBuildFlags(configuration,llvmDirectory,tailCall=false,interpreterProfile='fast') {
 const singleThread='-DWASM_ORC_JIT_BACKEND_THREAD_NUM=1 -DWASM_ORC_JIT_COMPILE_THREAD_NUM=1';
 if(!['fast','classic'].includes(interpreterProfile))throw Error('Unknown WAMR interpreter profile '+interpreterProfile);
 const classic=configuration==='wamr'&&interpreterProfile==='classic';
 // WAMR's exact build rules make these mutually exclusive: Fast Interpreter
 // supplies SIMD, while Classic Interpreter supplies Memory64 and multi-memory.
 // The feature campaign builds both profiles and selects the matching one per
 // workload; the ordinary performance configuration remains Fast Interpreter.
 const flags=['-DCMAKE_BUILD_TYPE=Release','-DCMAKE_C_FLAGS='+singleThread,'-DCMAKE_CXX_FLAGS='+singleThread,'-DWAMR_BUILD_INTERP=1','-DWAMR_BUILD_AOT=0','-DWAMR_DISABLE_STACK_HW_BOUND_CHECK=1','-DWAMR_BUILD_FAST_INTERP='+(configuration==='wamr'&&!classic?'1':'0'),'-DWAMR_BUILD_GC=1','-DWAMR_BUILD_EXCE_HANDLING='+(classic?'1':'0'),'-DWAMR_BUILD_EXTENDED_CONST_EXPR=1','-DWAMR_BUILD_MEMORY64='+(classic?'1':'0'),'-DWAMR_BUILD_SHARED_MEMORY=1','-DWAMR_BUILD_SIMD='+(configuration==='wamr-fast-jit'||classic?'0':'1'),'-DWAMR_BUILD_MULTI_MEMORY='+(classic?'1':'0'),'-DWAMR_BUILD_LIBC_WASI=0','-DWAMR_BUILD_LIBC_BUILTIN=0','-DBUILD_SHARED_LIBS=ON','-DWAMR_BUILD_LAZY_JIT=0'];
 if(configuration==='wamr-fast-jit')flags.push('-DWAMR_BUILD_FAST_JIT=1','-DWAMR_BUILD_JIT=0','-DWAMR_BUILD_GC=0','-DWAMR_BUILD_EXCE_HANDLING=0','-DWAMR_BUILD_SIMD=0');
 else if(configuration==='wamr-llvm-jit'){if(!llvmDirectory)throw Error('WAMR LLVM JIT requires an explicit LLVM SDK');flags.push('-DWAMR_BUILD_JIT=1','-DWAMR_BUILD_FAST_JIT=0','-DLLVM_DIR='+llvmDirectory);}
 else if(configuration==='wamr')flags.push('-DWAMR_BUILD_JIT=0','-DWAMR_BUILD_FAST_JIT=0');
 else throw Error('Unknown WAMR configuration '+configuration);
 // The classic feature profile is unaffected by the fast-interpreter-only
 // frame-reuse bug fixed by upstream #4917. Historical fast profiles retain
 // the explicit opt-in so older vulnerable revisions never enable tail calls.
 if(tailCall||classic)flags.push('-DWAMR_BUILD_TAIL_CALL=1');
 return flags;
}
export function wamrLLVMCompilerFlags(prefix,env={},platform=process.platform) {
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 const library=join(prefix,'lib/x86_64-unknown-linux-gnu');
 const singleThread='-DWASM_ORC_JIT_BACKEND_THREAD_NUM=1 -DWASM_ORC_JIT_COMPILE_THREAD_NUM=1';
 const link=['-fuse-ld='+quote(join(prefix,'bin/ld.lld')),'-L'+quote(library),quote('-Wl,-rpath,'+library),...privateGlibcLinkFlags(env,platform)].join(' ');
 // Compiler checks are executables: private libc's GLIBC_PRIVATE imports must
 // resolve against its matching loader, which must also start the executable.
 // Shared runtime libraries retain their existing startup policy.
 let executable=link;
 if(platform==='linux'&&env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR){
  const loader=join(env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR,'ld-linux-x86-64.so.2');
  executable+=' -Wl,--no-as-needed '+quote(loader)+' -Wl,--as-needed '+quote('-Wl,--dynamic-linker,'+loader);
 }
 return ['-DCMAKE_C_COMPILER='+join(prefix,'bin/clang'),'-DCMAKE_CXX_COMPILER='+join(prefix,'bin/clang++'),
  '-DCMAKE_CXX_FLAGS='+singleThread+' -stdlib=libc++ -nostdinc++ -isystem '+quote(join(prefix,'include/c++/v1')),
  '-DCMAKE_EXE_LINKER_FLAGS='+executable,'-DCMAKE_SHARED_LINKER_FLAGS='+link];
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
export async function configureWamrDarwinArm64SIMD(source,configuration,platform=process.platform,arch=process.arch) {
 if(configuration!=='wamr-llvm-jit'||platform!=='darwin'||arch!=='arm64')return null;
 const path=join(source,'core/iwasm/compilation/aot_llvm.c'),before=await readFile(path,'utf8');
 const marker='/* wasm.fyi: Apple LLVM may spell AArch64 as arm64 */';
 if(before.includes(marker))return {path,sha256:digest(Buffer.from(before))};
 const anchor='&& strncmp(comp_ctx->target_arch, "aarch64", 7) != 0\n        && strcmp(comp_ctx->target_arch, "arc") != 0';
 if(!before.includes(anchor))throw Error('WAMR Darwin ARM64 SIMD target policy changed');
 const after=before.replace(anchor,'&& strncmp(comp_ctx->target_arch, "aarch64", 7) != 0\n        '+marker+'\n        && strcmp(comp_ctx->target_arch, "arm64") != 0\n        && strcmp(comp_ctx->target_arch, "arc") != 0');
 await writeFile(path,after);return {path,originalSha256:digest(Buffer.from(before)),sha256:digest(Buffer.from(after))};
}
export async function buildWamrSDK({source,sdk,target,configuration,version,env,run}) {
 const unavailable=await wamrArchitectureUnavailable(source,configuration);
 if(unavailable){const error=Error(unavailable.reason);error.code='UNSUPPORTED_PLATFORM';error.proof=unavailable;throw error;}
 let llvmDirectory=env.LLVM_DIR;
 if(configuration==='wamr-llvm-jit'&&!llvmDirectory){for(const prefix of ['/opt/homebrew/opt/llvm@18','/usr/lib/llvm-18'])if(await stat(join(prefix,'lib/cmake/llvm/LLVMConfig.cmake')).catch(()=>null)){llvmDirectory=join(prefix,'lib/cmake/llvm');break;}}
 const interpreterProfile=env.WASMFYI_WAMR_INTERPRETER_PROFILE||'fast';
 const flags=wamrBuildFlags(configuration,llvmDirectory,env.WASMFYI_WAMR_FEATURE_PROPOSALS==='1',interpreterProfile);
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
 const darwinArm64SIMDPatch=await configureWamrDarwinArm64SIMD(source,configuration);
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
 env.WASMBENCH_WAMR_RUNNING_MODE=configuration==='wamr-llvm-jit'?'llvm-jit':configuration==='wamr-fast-jit'?'fast-jit':'interpreter';
 return {sdk,source,configuration,version,interpreterProfile,flags,compilerPrefix,measurementPatch,llvmLinkPatch,darwinArm64SIMDPatch,libraries:await Promise.all(libraries.map(async name=>({name,sha256:digest(await readFile(join(sdk,'lib',name)))})))};
}
