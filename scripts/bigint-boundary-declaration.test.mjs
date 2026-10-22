import test from 'node:test';
import assert from 'node:assert/strict';
import {declarationRequiredFeatures,runtimeDeclaresFeature} from './lib/feature-support.mjs';
test('native i64 arithmetic cannot prove JS BigInt integration',()=>{
 assert.equal(declarationRequiredFeatures.has('big-int'),true);
 for(const runtime of ['v8','spidermonkey','jsc'])assert.equal(runtimeDeclaresFeature({runtime},'big-int'),true);
 for(const runtime of ['wasmtime','wazero','chicory',undefined])assert.equal(runtimeDeclaresFeature({runtime,features:['big-int']},'big-int'),false);
});
