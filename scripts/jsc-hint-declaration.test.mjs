import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeDeclaresFeature} from './lib/feature-support.mjs';
test('JSC branch hint declaration requires the audited OMG source',()=>{
 for(const revision of ['f3e56c5b480ab4dc6bb6412abdfc35c2536467ec','b95c91b1c0ee43cc86d25ff7af73038f67a88e04']){
 const description={runtime:'jsc',backend:'OMG (forced tier-up)',runtime_version:revision};
 assert.equal(runtimeDeclaresFeature(description,'branch-hinting'),true);
 for(const change of [{runtime:'other'},{backend:'BBQ'},{runtime_version:'a'.repeat(40)}])
  assert.equal(runtimeDeclaresFeature({...description,...change},'branch-hinting'),false);
 assert.equal(runtimeDeclaresFeature(description,'compilation-hints'),false);
 }
});
