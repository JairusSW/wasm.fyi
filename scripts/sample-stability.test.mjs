import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleStability} from './lib/sample-stability.mjs';
test('stable first group finishes without warmups',()=>{
 const d=sampleStability([100,101,99,100,100]);assert(d.stable);assert(d.stop);assert.equal(d.retainedStart,0);
});
test('drifting or noisy samples continue up to 35',()=>{
 assert(!sampleStability([150,140,130,120,110]).stop);
 const d=sampleStability(Array.from({length:35},(_,i)=>i%2?100:200),35);assert(d.stop);assert(!d.stable);assert.equal(d.reason,'sample-cap');
});
test('settling trims an early prefix while preserving later outliers and raw order',()=>{
 const samples=[300,250,200,150,130,...Array(10).fill(100)],copy=[...samples];
 const d=sampleStability(samples);assert.equal(d.retainedStart,5);assert.equal(d.retainedCount,10);assert.deepEqual(samples,copy);
 const noisy=sampleStability([100,300,...Array(13).fill(100)]);assert.equal(noisy.retainedStart,0);
});

test('phase caps stop noisy ordered groups at 10 or 25 and retain legacy 35',()=>{
 for(const cap of [10,25,35]){
  const values=Array.from({length:cap},(_,i)=>i%2?100:200);
  assert.equal(sampleStability(values,cap).reason,'sample-cap');
  assert.equal(sampleStability(values.slice(0,5),cap).stop,false);
  assert.throws(()=>sampleStability([...values,...values.slice(0,5)],cap));
 }
});
