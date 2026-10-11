import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixtures} from '../corpora/features/generator.mjs';
import {repeatedFeatureExpected} from './lib/feature-performance.mjs';

test('globals compatibility and performance preserve scalar types and reset state across calls',async t=>{
 const root=process.env.WASMFYI_GLOBAL_PERFORMANCE_ROOT;
 if(!root){t.skip('Build globals artifacts and set WASMFYI_GLOBAL_PERFORMANCE_ROOT');return;}
 for(const f of fixtures().filter(f=>['core-glb','mutable-globals'].includes(f.feature))){
  const stem=f.feature+'-'+f.name;
  const semantic=await WebAssembly.compile(await readFile(join('corpora/features/artifacts',stem+'.wasm')));
  const performance=await WebAssembly.compile(await readFile(join(root,'artifacts',stem+'.wasm')));
  for(let fresh=0;fresh<2;fresh++){
   const instance=await WebAssembly.instantiate(semantic),batch=await WebAssembly.instantiate(performance);
   for(const n of [1,2,3,64,4096,1]){
    assert.equal(instance.exports.benchmark(n)>>>0,f.expected(n),stem+' correctness n='+n);
    assert.equal(batch.exports.performance(n)>>>0,repeatedFeatureExpected(f.expected(n)),stem+' performance n='+n);
   }
   if(f.name==='i64-carry-overflow')assert.equal(instance.exports.benchmark(1)>>>0,0);
   if(f.name==='f32-rounding-state')assert.equal(instance.exports.benchmark(1)>>>0,0x4b800000);
   if(f.feature==='mutable-globals'&&f.name==='dependent-read-write'){
    instance.exports.state.value=123;
    assert.equal(instance.exports.benchmark(64)>>>0,f.expected(64),'host mutation must not contaminate the next sample');
   }
  }
 }
});
