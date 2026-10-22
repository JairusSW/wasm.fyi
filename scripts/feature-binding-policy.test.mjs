import assert from 'node:assert/strict';
import test from 'node:test';
import {featureBindingForWorkload,featureBindingsForEngine,featureProfileForBinding} from './lib/feature-binding-policy.mjs';

const pin={revision:'a'.repeat(40),targetWeek:'2026-10-15T00:00:00.000Z'};
const binding=(engine,profile,path)=>({engine,job:{engine,featureProfile:profile,controller:path,harness:path,source:{revision:pin.revision,asOf:pin.targetWeek}},plan:{}});

test('WAMR uses its mutually exclusive fast and classic feature profiles by workload',()=>{
 const fast=binding('wamr',undefined,'fast'),classic=binding('wamr','classic','classic');
 const candidates=featureBindingsForEngine([fast,classic],'wamr',pin);
 assert.equal(featureBindingForWorkload(candidates,'wamr',{features:['simd']}),fast);
 assert.equal(featureBindingForWorkload(candidates,'wamr',{features:['relaxed-simd']}),fast);
 assert.equal(featureBindingForWorkload(candidates,'wamr',{features:['legacy-exceptions']}),classic);
 assert.equal(featureBindingForWorkload(candidates,'wamr',{features:['gc']}),classic);
 assert.equal(featureBindingForWorkload(candidates,'wamr',{features:['core-num']}),classic);
 assert.equal(featureProfileForBinding(fast,'wamr'),'fast');
 assert.equal(featureProfileForBinding(classic,'wamr'),'classic');
});

test('binding candidates are exact-pin and exact-path deduplicated',()=>{
 const exact=binding('wamr','classic','classic');
 const wrong={...binding('wamr','classic','wrong'),job:{...binding('wamr','classic','wrong').job,source:{revision:'b'.repeat(40),asOf:pin.targetWeek}}};
 assert.deepEqual(featureBindingsForEngine([exact,structuredClone(exact),wrong],'wamr',pin),[exact]);
});

test('other engines retain their single exact binding',()=>{
 const first=binding('wasmtime',undefined,'first'),second=binding('wasmtime','other','second');
 assert.equal(featureBindingForWorkload([first,second],'wasmtime',{features:['simd']}),first);
 assert.equal(featureProfileForBinding(first,'wasmtime'),null);
});
