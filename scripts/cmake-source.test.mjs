import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {configureCMakeSource} from './lib/cmake-source.mjs';

test('compiler migration replays discarded flags and honors the final ABI override',async()=>{
 const target=await mkdtemp(join(tmpdir(),'cmake-policy-'));
 try {
  let calls=0;
  const flags=['-DCMAKE_CXX_FLAGS=thread-policy','-DCMAKE_CXX_FLAGS=thread-policy -stdlib=libc++','-DCMAKE_SHARED_LINKER_FLAGS=-fuse-ld=lld'];
  await configureCMakeSource({source:'/source',target,flags,options:{cwd:'/source'},run:async(program,args,options)=>{
   assert.equal(program,'cmake');assert.deepEqual(args,['-S','/source','-B',target,...flags]);assert.equal(options.cwd,'/source');
   calls++;
   await writeFile(join(target,'CMakeCache.txt'),calls===1?'CMAKE_CXX_FLAGS:STRING=\nCMAKE_SHARED_LINKER_FLAGS:STRING=\n':'CMAKE_CXX_FLAGS:STRING=thread-policy -stdlib=libc++\nCMAKE_SHARED_LINKER_FLAGS:STRING=-fuse-ld=lld\n');
  }});
  assert.equal(calls,2);
 }finally{await rm(target,{recursive:true,force:true});}
});
test('persistent policy loss fails before building an incompatible SDK',async()=>{
 const target=await mkdtemp(join(tmpdir(),'cmake-policy-failure-'));
 try {
  let calls=0;
  await assert.rejects(configureCMakeSource({source:'/source',target,flags:['-DCMAKE_CXX_FLAGS=-stdlib=libc++'],run:async()=>{calls++;await writeFile(join(target,'CMakeCache.txt'),'CMAKE_CXX_FLAGS:STRING=\n');}}),/discarded required compiler\/link policy/);
  assert.equal(calls,2);
 }finally{await rm(target,{recursive:true,force:true});}
});
test('failed compiler-migration configure replays only proven discarded policy',async()=>{
 const target=await mkdtemp(join(tmpdir(),'cmake-failed-migration-'));
 try{
  await writeFile(join(target,'CMakeCache.txt'),'CMAKE_CXX_COMPILER:FILEPATH=/old/c++\nCMAKE_CXX_FLAGS:STRING=\n');
  let calls=0;
  await configureCMakeSource({source:'/source',target,flags:['-DCMAKE_CXX_COMPILER=/new/clang++','-DCMAKE_CXX_FLAGS=-stdlib=libc++'],run:async()=>{
   calls++;await writeFile(join(target,'CMakeCache.txt'),'CMAKE_CXX_COMPILER:FILEPATH=/new/clang++\nCMAKE_CXX_FLAGS:STRING='+(calls===1?'':'-stdlib=libc++')+'\n');
   if(calls===1)throw Error('ABI probe failed after compiler cache reset');
  }});
  assert.equal(calls,2);
 }finally{await rm(target,{recursive:true,force:true})}
});
test('genuine configure failures are preserved without blind retries',async()=>{
 const target=await mkdtemp(join(tmpdir(),'cmake-real-failure-'));
 try{
  let calls=0;const failure=Error('missing required dependency');
  await assert.rejects(configureCMakeSource({source:'/source',target,flags:['-DCMAKE_CXX_COMPILER=/new/clang++','-DCMAKE_CXX_FLAGS=-stdlib=libc++'],run:async()=>{calls++;throw failure}}),error=>error===failure);
  assert.equal(calls,1);
 }finally{await rm(target,{recursive:true,force:true})}
});
