import test from 'node:test';
import assert from 'node:assert/strict';
import {declarationRequiredFeatures,runtimeDeclaresFeature} from './lib/feature-support.mjs';
test('binary semantic controls cannot establish source-format or extended-name implementation',()=>{
 for(const feature of ['extended-name-section','custom-annotation-syntax-in-the-text-format','numeric-values-in-wat']){
  assert.equal(declarationRequiredFeatures.has(feature),true);
  assert.equal(runtimeDeclaresFeature({runtime:'v8',effective_configuration:{flags:'["--experimental-wasm-branch-hinting"]'}},feature),false);
  assert.equal(runtimeDeclaresFeature({features:[feature]},feature),true);
 }
});
