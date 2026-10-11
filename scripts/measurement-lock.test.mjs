import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireMeasurementLock,withBuildLock} from './lib/measurement-lock.mjs';
test('serializes collectors and releases the measurement slot',async()=>{
 const root=await mkdtemp(join(tmpdir(),'measurement-lock-')),path=join(root,'lock');
 try{const release=await acquireMeasurementLock(path);const abort=new AbortController();const waiting=acquireMeasurementLock(path,abort.signal);abort.abort();await assert.rejects(waiting,{name:'AbortError'});await release();await (await acquireMeasurementLock(path))();}finally{await rm(root,{recursive:true,force:true})}
});
test('recovers a terminated collector lock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'measurement-lock-')),path=join(root,'lock');
 try{await mkdir(path);await writeFile(join(path,'owner'),'2147483647');await (await acquireMeasurementLock(path))();}finally{await rm(root,{recursive:true,force:true})}
});

test('SDK builds wait for measurements and release the slot after a build failure',async()=>{
 const root=await mkdtemp(join(tmpdir(),'measurement-build-lock-')),path=join(root,'measurement-lock');
 try{
  const release=await acquireMeasurementLock(path);let building=false;
  const build=withBuildLock(root,async()=>{building=true;});
  await new Promise(resolve=>setTimeout(resolve,300));assert.equal(building,false);
  await release();await build;assert.equal(building,true);
  await assert.rejects(withBuildLock(root,async()=>{throw Error('build failed')}),/build failed/);
  await (await acquireMeasurementLock(path))();
 }finally{await rm(root,{recursive:true,force:true})}
});
