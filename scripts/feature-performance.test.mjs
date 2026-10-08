import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {repeatedFeatureExpected} from './lib/feature-performance.mjs';
import {collectFeatureBatches,minimumFeatureBatch} from './lib/feature-timing.mjs';
import {fixtures} from '../corpora/features/generator.mjs';
const trial=(elapsed,operations=1)=>[{block:0,status:'ok',profile:'timing',scenario:'steady',samples:[{warmup:false,verified:true,elapsed_ns:elapsed,operations}]}];
test('repetition oracles use Wasm i32 wrapping rather than lossy Number multiplication',()=>{assert.equal(repeatedFeatureExpected(0xffffffff,64),0xffffffc0)});
test('source-built allocation kernels retain distinct observable objects across repeated calls',async t=>{
 const root=process.env.WASMFYI_FEATURE_PERFORMANCE_ROOT;
 if(!root){t.skip('Build feature performance artifacts and set WASMFYI_FEATURE_PERFORMANCE_ROOT');return;}
 for(const f of fixtures().filter(f=>f.feature==='gc'&&['struct-allocation-access','array-allocation-access','array-fill'].includes(f.name))){
  const module=await WebAssembly.compile(await readFile(join(root,'artifacts',f.feature+'-'+f.name+'.wasm'))),n=Math.max(...f.sizes);
  for(let fresh=0;fresh<2;fresh++){
   const {exports:e}=await WebAssembly.instantiate(module);let previous;
   for(let call=0;call<2;call++){
    assert.equal(e.performance(n)>>>0,repeatedFeatureExpected(f.expected(n)));
    assert.equal(e['retained-count'](),n);
    for(const index of [0,n>>1,n-1]){assert.equal(e['retained-value'](index),index);assert.equal(e['retained-object'](index),e['retained-object'](index));}
    assert.notEqual(e['retained-object'](0),e['retained-object'](n-1));
    const first=e['retained-object'](0);if(previous)assert.notEqual(first,previous);previous=first;
   }
  }
 }
});
test('steady calibration discards short runs and ignores preflight and warmup durations',async()=>{
 let calls=0;const out=await collectFeatureBatches({directory:'/tmp/check',run:async()=>{calls++},load:async()=>calls===1?trial(1_000_000):trial(60_000_000,63)});
 assert.equal(calls,2);assert(out.endsWith('-1'));
 assert.equal(minimumFeatureBatch([{...trial(1)[0],block:-1},...trial(60_000_000)]),60_000_000);
});
test('an adapter forcing fresh instances cannot silently publish short batches',async()=>{await assert.rejects(collectFeatureBatches({directory:'/tmp/check',run:async()=>{},load:async()=>trial(1000)}),/Fresh-instance/)});
