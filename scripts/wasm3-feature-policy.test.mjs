import test from 'node:test';
import assert from 'node:assert/strict';
import {wasm3FeatureCMakeFlags,wasm3FeatureEmbeddingSource} from './lib/wasm3-feature-policy.mjs';

const original='before;check(m3_LoadModule(m->runtime,m->module));m->loaded=true;after';
test('wasm3 transfers module ownership before checking load initialization',()=>{
 const patched=wasm3FeatureEmbeddingSource(original);
 assert.match(patched,/M3Result loaded=m3_LoadModule\(m->runtime,m->module\);m->loaded=true;check\(loaded\);/);
 assert.equal(wasm3FeatureEmbeddingSource(patched),patched);
});
test('wasm3 feature SDK uses checked memories for custom page sizes',()=>{
 assert.deepEqual(wasm3FeatureCMakeFlags,['-DCMAKE_C_FLAGS=-Dd_m3GuardedMemory=0']);
});
test('changed wasm3 ownership contracts fail closed',()=>{
 assert.throws(()=>wasm3FeatureEmbeddingSource('different'),/source contract changed/);
});
