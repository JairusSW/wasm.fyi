import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configureWavmSource} from './lib/wavm-sdk.mjs';

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
