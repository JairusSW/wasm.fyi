import {readFile,mkdir,cp,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {digest} from './wasmbench.mjs';
export async function buildWavmSDK({source,sdk,target,env,run}) {
 const prefixes=[env.WASMBENCH_WAVM_LLVM_PREFIX,'/opt/homebrew/opt/llvm@20',join(homedir(),'.cache/wasm-fyi/toolchains/llvm-20.1.8'),'/usr/lib/llvm-20'].filter(Boolean);
 let llvmDirectory;
 for(const prefix of prefixes)if(await stat(join(prefix,'lib/cmake/llvm/LLVMConfig.cmake')).catch(()=>null)){llvmDirectory=join(prefix,'lib/cmake/llvm');break;}
 if(!llvmDirectory)throw Error('WAVM source build requires a qualified LLVM 20 SDK');
 const dependencyPrefix=join(homedir(),'.cache/wasm-fyi/toolchains/lld-18/usr');
 const dependencyFlags=await stat(dependencyPrefix).catch(()=>null)?['-DCMAKE_PREFIX_PATH='+dependencyPrefix]:[];
 const zstdPrefix=join(homedir(),'.cache/wasm-fyi/toolchains/zstd-1.5.5-pic');
 const zstdFlags=await stat(join(zstdPrefix,'lib/libzstd.a')).catch(()=>null)?['-Dzstd_STATIC_LIBRARY='+join(zstdPrefix,'lib/libzstd.a'),'-Dzstd_INCLUDE_DIR='+join(zstdPrefix,'include')]:[];
 const flags=[...zstdFlags,...dependencyFlags,'-DCMAKE_BUILD_TYPE=Release','-DCMAKE_INSTALL_PREFIX='+sdk,'-DLLVM_DIR='+llvmDirectory,'-DWAVM_ENABLE_STATIC_LINKING=OFF','-DWAVM_ENABLE_FUZZ_TARGETS=OFF','-DWAVM_ENABLE_LTO=OFF'];
 // The official Linux LLVM SDK ships bitcode archives; use its matching
 // compiler and linker rather than GNU ld, which cannot consume those archives.
 if(process.platform==='linux'){const prefix=resolve(llvmDirectory,'../../..'),cxxLib=join(prefix,'lib/x86_64-unknown-linux-gnu');env.WASMBENCH_WAVM_CXX_SDK=prefix;flags.push('-DCMAKE_C_COMPILER='+join(prefix,'bin/clang'),'-DCMAKE_CXX_COMPILER='+join(prefix,'bin/clang++'),'-DCMAKE_CXX_FLAGS=-stdlib=libc++','-DCMAKE_EXE_LINKER_FLAGS=-Wl,-rpath,'+cxxLib,'-DCMAKE_SHARED_LINKER_FLAGS=-fuse-ld='+join(prefix,'bin/ld.lld')+' -Wl,-rpath,'+cxxLib);}
 await run('cmake',['-S',source,'-B',target,...flags]);
 await run('cmake',['--build',target,'--target','libWAVM','-j','2']);
 await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
 await cp(join(source,'Include/WAVM'),join(sdk,'include/WAVM'),{recursive:true});
 for(const name of ['Config.h','Version.h'])await cp(join(target,'Include/WAVM/Inline',name),join(sdk,'include/WAVM/Inline',name));
 let libraryDirectory=target;
 let libraries=(await readdir(target)).filter(name=>/^libWAVM.*\.(?:so|dylib)(?:\.[\d.]+)?$/.test(name));
 if(!libraries.length){libraryDirectory=join(target,'lib');libraries=(await readdir(libraryDirectory)).filter(name=>/^libWAVM.*\.(?:so|dylib)(?:\.[\d.]+)?$/.test(name));}
 if(!libraries.length)throw Error('WAVM source build did not produce its shared library');
 for(const name of libraries)await cp(join(libraryDirectory,name),join(sdk,'lib',name),{dereference:true});
 env.WASMBENCH_WAVM_SDK=sdk;
 return {source,sdk,flags,llvmDirectory,libraries:await Promise.all(libraries.map(async name=>({name,sha256:digest(await readFile(join(sdk,'lib',name)))})))};
}
