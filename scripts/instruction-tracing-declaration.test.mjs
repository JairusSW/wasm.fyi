import test from 'node:test';
import assert from 'node:assert/strict';
import {declarationRequiredFeatures,runtimeDeclaresFeature} from './lib/feature-support.mjs';
test('ignorable instruction trace metadata requires an enabled implementation declaration',()=>{
 const feature='instrument-and-tracing-technology';
 assert.equal(declarationRequiredFeatures.has(feature),true);
 assert.equal(runtimeDeclaresFeature({},feature),false);
 assert.equal(runtimeDeclaresFeature({effective_configuration:{flags:'["--experimental-wasm-branch-hinting"]'}},feature),false);
 assert.equal(runtimeDeclaresFeature({effective_configuration:{flags:'["--experimental-wasm-instruction-tracing"]'}},feature),true);
 assert.equal(runtimeDeclaresFeature({validator_features:{supported:{INSTRUCTION_TRACING:true}}},feature),true);
});
