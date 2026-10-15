import {readFile,writeFile,mkdir,cp,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir,availableParallelism} from 'node:os';
import {digest} from './wasmbench.mjs';
import {privateGlibcLinkFlags} from './private-glibc-link.mjs';
export async function configureWavmSource(source,target,flags,run) {
 const configure=()=>run('cmake',['-S',source,'-B',target,...flags]);
 const expected=flags.filter(flag=>/^-DCMAKE_(?:CXX_FLAGS|EXE_LINKER_FLAGS|SHARED_LINKER_FLAGS)=/.test(flag)).map(flag=>flag.slice(2));
 const matches=async()=>{
  const cache=await readFile(join(target,'CMakeCache.txt'),'utf8');
  return expected.every(entry=>{const split=entry.indexOf('='),key=entry.slice(0,split),value=entry.slice(split+1).trimEnd();return cache.split('\n').some(line=>line===key+':STRING='+value);});
 };
 await configure();
 // Changing compilers makes CMake regenerate the cache and discard flags from
 // that first invocation. Reapply and verify the intended C++ ABI explicitly.
 if(!await matches())await configure();
 if(!await matches())throw Error('WAVM CMake cache discarded required compiler/link policy');
}
export async function buildWavmSDK({source,sdk,target,harness,env,run}) {
 const prefixes=[env.WASMBENCH_WAVM_LLVM_PREFIX,'/opt/homebrew/opt/llvm@20',join(homedir(),'.cache/wasm-fyi/toolchains/llvm-20.1.8'),'/usr/lib/llvm-20'].filter(Boolean);
 let llvmDirectory;
 for(const prefix of prefixes)if(await stat(join(prefix,'lib/cmake/llvm/LLVMConfig.cmake')).catch(()=>null)){llvmDirectory=join(prefix,'lib/cmake/llvm');break;}
 if(!llvmDirectory)throw Error('WAVM source build requires a qualified LLVM 20 or newer SDK');
 const dependencyPrefix=join(homedir(),'.cache/wasm-fyi/toolchains/lld-18/usr');
 const dependencyFlags=await stat(dependencyPrefix).catch(()=>null)?['-DCMAKE_PREFIX_PATH='+dependencyPrefix]:[];
 const zstdPrefix=join(homedir(),'.cache/wasm-fyi/toolchains/zstd-1.5.5-pic');
 const zstdFlags=await stat(join(zstdPrefix,'lib/libzstd.a')).catch(()=>null)?['-Dzstd_STATIC_LIBRARY='+join(zstdPrefix,'lib/libzstd.a'),'-Dzstd_INCLUDE_DIR='+join(zstdPrefix,'include')]:[];
 const flags=[...zstdFlags,...dependencyFlags,'-DCMAKE_BUILD_TYPE=Release','-DCMAKE_INSTALL_PREFIX='+sdk,'-DLLVM_DIR='+llvmDirectory,'-DWAVM_ENABLE_STATIC_LINKING=OFF','-DWAVM_ENABLE_FUZZ_TARGETS=OFF','-DWAVM_ENABLE_LTO=OFF'];
 // The official Linux LLVM SDK ships bitcode archives; use its matching
 // compiler and linker rather than GNU ld, which cannot consume those archives.
 if(process.platform==='linux'){
  const prefix=resolve(llvmDirectory,'../../..'),cxxPrefix=env.WASMFYI_WAVM_CXX_SDK?resolve(env.WASMFYI_WAVM_CXX_SDK):prefix,cxxLib=join(cxxPrefix,'lib/x86_64-unknown-linux-gnu');
  env.WASMBENCH_WAVM_CXX_SDK=cxxPrefix;
  env.WASMBENCH_WAVM_CXX_STDLIB=env.WASMFYI_WAVM_CXX_STDLIB||'libc++';
  const stdlib=wavmCxxFlags(env,cxxPrefix,prefix);
  flags.push('-DCMAKE_C_COMPILER='+join(cxxPrefix,'bin/clang'),'-DCMAKE_CXX_COMPILER='+join(cxxPrefix,'bin/clang++'),'-DCMAKE_CXX_FLAGS='+stdlib,'-DCMAKE_EXE_LINKER_FLAGS=-L'+cxxLib+' -Wl,-rpath,'+cxxLib,'-DCMAKE_SHARED_LINKER_FLAGS=-L'+cxxLib+' -fuse-ld='+join(prefix,'bin/ld.lld')+' -Wl,-rpath,'+cxxLib+' -Wl,--no-undefined '+privateGlibcLinkFlags(env).join(' '));
 }
 await configureWavmSource(source,target,flags,run);
 await run('cmake',['--build',target,'--target','libWAVM','-j',String(env.WASMFYI_BUILD_JOBS||availableParallelism())]);
 await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
 await cp(join(source,'Include/WAVM'),join(sdk,'include/WAVM'),{recursive:true});
 for(const name of ['Config.h','Version.h'])await cp(join(target,'Include/WAVM/Inline',name),join(sdk,'include/WAVM/Inline',name));
 let libraryDirectory=target;
 let libraries=(await readdir(target)).filter(name=>/^libWAVM.*\.(?:so|dylib)(?:\.[\d.]+)?$/.test(name));
 if(!libraries.length){libraryDirectory=join(target,'lib');libraries=(await readdir(libraryDirectory)).filter(name=>/^libWAVM.*\.(?:so|dylib)(?:\.[\d.]+)?$/.test(name));}
 if(!libraries.length)throw Error('WAVM source build did not produce its shared library');
 for(const name of libraries)await cp(join(libraryDirectory,name),join(sdk,'lib',name),{dereference:true});
 let adapterBuildScriptSha256;
 if(process.platform==='linux'&&harness){
  const path=join(harness,'adapters/native/build.rs'),before=await readFile(path,'utf8'),after=wavmAdapterABI(before,env.WASMBENCH_WAVM_CXX_STDLIB);
  if(after!==before)await writeFile(path,after);
  adapterBuildScriptSha256=digest(Buffer.from(after));
 }
 env.WASMBENCH_WAVM_SDK=sdk;
 return {source,sdk,flags,llvmDirectory,adapterCxxStdlib:env.WASMBENCH_WAVM_CXX_STDLIB,adapterBuildScriptSha256,libraries:await Promise.all(libraries.map(async name=>({name,sha256:digest(await readFile(join(sdk,'lib',name)))})))};
}
export function wavmAdapterABI(source,stdlib){
 if(!['libc++','libstdc++'].includes(stdlib))throw Error('Invalid WAVM C++ standard library');
 const statement=selected=>'build.compiler(sdk.join("bin/clang++")).flag("-stdlib='+selected+'").cpp_link_stdlib("'+(selected==='libc++'?'c++':'stdc++')+'");';
 if(source.includes(statement(stdlib)))return source;
 const before=statement(stdlib==='libc++'?'libstdc++':'libc++');
 if(!source.includes(before))throw Error('WAVM adapter C++ ABI seam changed');
 return source.replace(before,statement(stdlib));
}
// Match the C++ ABI used to build LLVM itself. Official LLVM downloads use
// libc++; WAVM's own LLVM build can use the host libstdc++ instead.
export function wavmCxxFlags(env,cxxPrefix,prefix){
 const stdlib=env.WASMFYI_WAVM_CXX_STDLIB||'libc++';
 if(!['libc++','libstdc++'].includes(stdlib))throw Error('Invalid WAVM C++ standard library');
 return '-stdlib='+stdlib+(stdlib==='libc++'&&cxxPrefix!==prefix?' -Wno-error=unused-command-line-argument -nostdinc++ -I'+join(cxxPrefix,'include/c++/v1'):'');
}
