import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configureWavmSource,wavmCxxFlags} from './lib/wavm-sdk.mjs';

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
