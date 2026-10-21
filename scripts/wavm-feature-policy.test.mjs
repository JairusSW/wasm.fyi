import test from 'node:test';import assert from 'node:assert/strict';
import {withWavmMemory64CAPI,withWavmFeatureEngine,withWavmDiagnosticFeatures} from './lib/wavm-feature-policy.mjs';
test('exposes source-declared memory64 through WAVM C API idempotently',()=>{
 const once=withWavmMemory64CAPI('WASM_DECLARE_FEATURE(multimemory)','IMPLEMENT_FEATURE(multimemory, multipleMemories)');
 assert.match(once.header,/FEATURE\(memory64\)/);assert.match(once.implementation,/FEATURE\(memory64, memory64\)/);
 assert.deepEqual(withWavmMemory64CAPI(once.header,once.implementation),once);
});
test('diagnoses rejected modules with every source-declared proposal enabled',()=>{
 const source='if(!load(bytes,WAVM::IR::FeatureSpec(),&error)) fail();';const once=withWavmDiagnosticFeatures(source);assert.match(once,/FeatureLevel::proposed/);assert.equal(withWavmDiagnosticFeatures(once),once);
});
test('constructs the WAVM engine with all source-declared WebAssembly features',()=>{
 const source='struct Engine { wasm_engine_t* value=wasm_engine_new(); ~Engine(){if(value)wasm_engine_delete(value);} };';
 const once=withWavmFeatureEngine(source);for(const name of ['atomics','exception_handling','extended_name_section','multimemory','memory64'])assert.match(once,new RegExp('feature_set_'+name));assert.equal(withWavmFeatureEngine(once),once);
});
