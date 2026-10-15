import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configureWavmSource,buildWavmSDK,wavmCxxFlags,wavmAdapterABI} from './lib/wavm-sdk.mjs';

test('Linux SDK setup writes the bridge ABI and includes its digest in the receipt',{skip:process.platform!=='linux'},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wavm-sdk-abi-'));
 const source=join(directory,'source'),sdk=join(directory,'sdk'),target=join(directory,'build'),harness=join(directory,'harness'),llvm=join(directory,'llvm');
 try{
  for(const path of [join(source,'Include/WAVM'),join(target,'Include/WAVM/Inline'),join(harness,'adapters/native'),join(llvm,'lib/cmake/llvm')])await mkdir(path,{recursive:true});
  await writeFile(join(llvm,'lib/cmake/llvm/LLVMConfig.cmake'),'');
  for(const name of ['Config.h','Version.h'])await writeFile(join(target,'Include/WAVM/Inline',name),'fixture');
  await writeFile(join(target,'libWAVM.so'),'fixture-library');
  const bridge=join(harness,'adapters/native/build.rs');
  await writeFile(bridge,'build.compiler(sdk.join("bin/clang++")).flag("-stdlib=libc++").cpp_link_stdlib("c++");');
  const env={WASMBENCH_WAVM_LLVM_PREFIX:llvm,WASMFYI_WAVM_CXX_STDLIB:'libstdc++'};
  const receipt=await buildWavmSDK({source,sdk,target,harness,env,run:async(program,args)=>{
   assert.equal(program,'cmake');
   if(args.includes('-S'))await writeFile(join(target,'CMakeCache.txt'),args.filter(a=>a.startsWith('-DCMAKE_')).map(a=>a.slice(2).trimEnd().replace('=',':STRING=')).join('\n'));
  }});
  assert.match(await readFile(bridge,'utf8'),/cpp_link_stdlib\("stdc\+\+"\)/);
  assert.equal(receipt.adapterCxxStdlib,'libstdc++');assert.match(receipt.adapterBuildScriptSha256,/^[a-f0-9]{64}$/);
  assert.equal(await readFile(join(sdk,'lib/libWAVM.so'),'utf8'),'fixture-library');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('native bridge compiler and Rust linker use the same C++ ABI as the WAVM SDK',()=>{
 const original='// unrelated policy\nbuild.compiler(sdk.join("bin/clang++")).flag("-stdlib=libc++").cpp_link_stdlib("c++");';
 const selected=wavmAdapterABI(original,'libstdc++');
 assert.match(selected,/flag\("-stdlib=libstdc\+\+"\)\.cpp_link_stdlib\("stdc\+\+"\)/);
 assert.equal(wavmAdapterABI(selected,'libstdc++'),selected);
 assert.equal(wavmAdapterABI(selected,'libc++'),original);
 assert.throws(()=>wavmAdapterABI('unknown upstream build script','libstdc++'),/seam changed/);
});

test('LLVM ABI selection keeps host libstdc++ headers separate from libc++ SDK headers',()=>{
 assert.equal(wavmCxxFlags({},'/llvm','/llvm'),'-stdlib=libc++');
 assert.match(wavmCxxFlags({},'/cxx','/llvm'),/-nostdinc\+\+ -I\/cxx\/include\/c\+\+\/v1$/);
 assert.equal(wavmCxxFlags({WASMFYI_WAVM_CXX_STDLIB:'libstdc++'},'/cxx','/llvm'),'-stdlib=libstdc++');
 assert.throws(()=>wavmCxxFlags({WASMFYI_WAVM_CXX_STDLIB:'unknown'},'/cxx','/llvm'),/Invalid WAVM/);
});

test('compiler-change cache regeneration cannot silently change the SDK C++ ABI',async()=>{
 const target=await mkdtemp(join(tmpdir(),'wavm-cmake-policy-'));
 const flags=['-DCMAKE_CXX_FLAGS=-stdlib=libc++ -nostdinc++','-DCMAKE_SHARED_LINKER_FLAGS=-L/compatible/lib'];
 try {
  let calls=0;
  await configureWavmSource('/source',target,flags,async()=>{
   calls++;await writeFile(join(target,'CMakeCache.txt'),calls===1?'CMAKE_CXX_FLAGS:STRING=\n':flags.map(flag=>flag.slice(2).replace('=',':STRING=')).join('\n'));
  });assert.equal(calls,2);
  await assert.rejects(configureWavmSource('/source',target,flags,async()=>writeFile(join(target,'CMakeCache.txt'),'CMAKE_CXX_FLAGS:STRING=\n')),/discarded required compiler/);
 } finally {await rm(target,{recursive:true,force:true});}
});

test('CMake trimming trailing whitespace preserves the requested linker policy',async()=>{
 const target=await mkdtemp(join(tmpdir(),'wavm-cmake-whitespace-'));
 const flags=['-DCMAKE_CXX_FLAGS=-stdlib=libstdc++','-DCMAKE_SHARED_LINKER_FLAGS=-Wl,--no-undefined '];
 try{
  await configureWavmSource('/source',target,flags,async()=>writeFile(join(target,'CMakeCache.txt'),flags.map(flag=>flag.slice(2).trimEnd().replace('=',':STRING=')).join('\n')));
 }finally{await rm(target,{recursive:true,force:true});}
});
