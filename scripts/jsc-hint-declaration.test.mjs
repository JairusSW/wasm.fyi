import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeDeclaresFeature} from './lib/feature-support.mjs';
test('JSC branch hint declaration requires the audited OMG source',()=>{
 const description={runtime:'jsc',backend:'OMG (forced tier-up)',runtime_version:'f3e56c5b480ab4dc6bb6412abdfc35c2536467ec'};
 assert.equal(runtimeDeclaresFeature(description,'branch-hinting'),true);
 for(const change of [{runtime:'other'},{backend:'BBQ'},{runtime_version:'a'.repeat(40)}])
  assert.equal(runtimeDeclaresFeature({...description,...change},'branch-hinting'),false);
 assert.equal(runtimeDeclaresFeature(description,'compilation-hints'),false);
});
