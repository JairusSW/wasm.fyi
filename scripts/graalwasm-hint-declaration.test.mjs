import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeDeclaresFeature} from './lib/feature-support.mjs';
test('Graal branch hint declaration is bound to the audited source and backend',()=>{
 const description={runtime:'graalwasm',backend:'truffle-graal',runtime_version:'f1dce3f84de778485d0ba8d6ddfd4d260b230d0a'};
 assert.equal(runtimeDeclaresFeature(description,'branch-hinting'),true);
 assert.equal(runtimeDeclaresFeature({...description,runtime_version:'a'.repeat(40)},'branch-hinting'),false);
 assert.equal(runtimeDeclaresFeature({...description,backend:'other'},'branch-hinting'),false);
 assert.equal(runtimeDeclaresFeature({...description,runtime:'other'},'branch-hinting'),false);
 assert.equal(runtimeDeclaresFeature(description,'compilation-hints'),false);
});

test('current Graal source consumes branch hints without an optional flag',()=>{
 const d={runtime:'graalwasm',backend:'truffle-graal',runtime_version:'092eca6772a74d4ce501d5656f61cfb26745ce73'};
 assert.equal(runtimeDeclaresFeature(d,'branch-hinting'),true);
 assert.equal(runtimeDeclaresFeature({...d,backend:'other'},'branch-hinting'),false);
 assert.equal(runtimeDeclaresFeature(d,'compilation-hints'),false);
});
