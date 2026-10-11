import {test} from 'node:test';import assert from 'node:assert/strict';
import {withWavmFeaturePolicy} from './lib/wavm-feature-policy.mjs';
const fixture=`struct Engine { wasm_engine_t* value=wasm_engine_new(); ~Engine(){if(value)wasm_engine_delete(value);} };
if(!WAVM::Runtime::loadBinaryModule(bytes,size,module))throw error;
loadBinaryModule(bytes,size,*module,WAVM::IR::FeatureSpec(),&error);
loadBinaryModule(data,size,diagnostic,WAVM::IR::FeatureSpec(),&loadError);`;
test('configured engine and code/WASI/diagnostic loaders share enabled feature specification',()=>{
 const s=withWavmFeaturePolicy(fixture);
 assert.match(s,/spec.memory64=true; spec.multipleMemories=true/);
 assert.match(s,/wasm_config_feature_set_memory64\(config,true\)/);assert.match(s,/wasm_config_feature_set_multimemory\(config,true\)/);
 assert.match(s,/loadBinaryModule\(bytes,size,module,wb_feature_spec\(\)\)/);
 assert.match(s,/loadBinaryModule\(bytes,size,\*module,wb_feature_spec\(\),&error\)/);
 assert.match(s,/loadBinaryModule\(data,size,diagnostic,wb_feature_spec\(\),&loadError\)/);
 assert.equal(withWavmFeaturePolicy(s),s);
});
test('unknown or partially patched loader seams fail closed',()=>{
 assert.throws(()=>withWavmFeaturePolicy(fixture.replace('loadBinaryModule(bytes,size,module))','changed_loader()')));
 assert.throws(()=>withWavmFeaturePolicy(withWavmFeaturePolicy(fixture)+' WAVM::IR::FeatureSpec()'));
});
