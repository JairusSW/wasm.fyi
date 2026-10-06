import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProgressDelivery} from './lib/api-progress-delivery.mjs';
const plan={id:'session',identity:'a'.repeat(64),machines:[{name:'local'}],jobs:[{id:'corpus-0001'}]};
function server(){const states=new Map(),calls=[];return {states,calls,readState:async u=>states.get(u.attempt)||null,send:async u=>{const old=states.get(u.attempt);if(old?.update.sequence===u.sequence){assert.deepEqual(old.update,u);return old};assert.equal(u.sequence,(old?.update.sequence||0)+1);const receipt={id:'b'.repeat(64),update:u};states.set(u.attempt,receipt);calls.push(u);return receipt}}}
const event=(status,extra={})=>({machine:'local',corpus:'corpus-0001',status,time:'2026-10-06T00:00:00.000Z',...extra});
test('delivery preserves source events, replays lost acknowledgement and honors server rollback',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wasmfyi-progress-'));try{
  const remote=server();let lost=true;const delivery=new ProgressDelivery({directory,plan,...remote,send:async u=>{const r=await remote.send(u);if(lost){lost=false;throw Error('lost reply')};return r}});
  const first=delivery.record(event('running',{phase:'timing',result:{samples:['not journaled']}}));await assert.rejects(delivery.flush(),/lost reply/);
  delivery.record(event('paused'));assert.equal(delivery.record(event('error')),null,'Duplicate terminal event invented another attempt');assert.equal(delivery.latest.get(first.attempt).status,'interrupted');
  const resumed=new ProgressDelivery({directory,plan,...remote});await resumed.replay();assert.equal(remote.states.get(first.attempt).update.sequence,2);assert.equal(remote.calls.length,2);
  await resumed.replay();assert.equal(remote.calls.length,2,'Replayed already confirmed events');
  remote.states.clear();await resumed.replay();assert.equal(remote.calls.length,4,'Local journal failed to recover rolled-back API');
  assert(!('result' in first));assert(!('samples' in first));
  const next=resumed.record(event('running',{phase:'memory'}));assert.notEqual(next.attempt,first.attempt);await resumed.flush();assert.equal(remote.states.size,2);
 }finally{await rm(directory,{recursive:true,force:true})}
});
test('interruption closes recovered running attempts and queued overflow remains recoverable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wasmfyi-progress-'));try{
  const remote=server();let unblock;const held=new Promise(r=>unblock=r);
  const delivery=new ProgressDelivery({directory,plan,...remote,maxPending:1,send:async u=>{await held;return remote.send(u)}});
  const first=delivery.record(event('running'));assert.throws(()=>delivery.record(event('paused')),/queue exceeds/);unblock();await delivery.flush();
  const resumed=new ProgressDelivery({directory,plan,...remote});await resumed.replay();assert.equal(remote.states.get(first.attempt).update.status,'interrupted');
  const second=resumed.record(event('running'));await resumed.flush();
  const recovery=new ProgressDelivery({directory,plan,...remote});await recovery.replay();await recovery.interruptPrevious('local');assert.equal(remote.states.get(second.attempt).update.status,'interrupted');
  assert.equal(recovery.record(event('completed',{resumed:true})),null,'Reused measurements became a new attempt');
 }finally{await rm(directory,{recursive:true,force:true})}
});
test('delivery rejects records outside the plan and divergent remote state',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wasmfyi-progress-'));try{
  const remote=server(),delivery=new ProgressDelivery({directory,plan,...remote});assert.throws(()=>delivery.record(event('running',{machine:'outside'})),/locked scope/);
  const first=delivery.record(event('running'));await delivery.flush();remote.states.set(first.attempt,{id:'b'.repeat(64),update:{...first,status:'completed'}});
  const resumed=new ProgressDelivery({directory,plan,...remote});await assert.rejects(resumed.replay(),/differs from journal/);
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('journal corruption and event ceilings fail before further delivery',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wasmfyi-progress-'));try{
  const remote=server(),delivery=new ProgressDelivery({directory,plan,...remote,maxEvents:2});
  delivery.record(event('running'));delivery.record(event('paused'));await delivery.flush();
  assert.throws(()=>delivery.record(event('running')),/journal exceeds ceiling/);
  const first=delivery.names[0];await unlink(join(directory,first));
  assert.throws(()=>new ProgressDelivery({directory,plan,...remote}),/Incomplete progress journal/);
  await writeFile(join(directory,first),'x'.repeat(2049));
  assert.throws(()=>new ProgressDelivery({directory,plan,...remote}),/Invalid progress journal file/);
 }finally{await rm(directory,{recursive:true,force:true})}
});
