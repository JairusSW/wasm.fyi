import test from 'node:test';
import assert from 'node:assert/strict';
import {featureValidationSizes,featureValidationWorkload} from './lib/feature-validation.mjs';
import {fixtures} from '../corpora/features/generator.mjs';
test('boundary inputs exercise both sides of interior benchmark sizes without exceeding allocation limits',()=>{
 assert.deepEqual(featureValidationSizes({sizes:[1,64,4096],scope:'execution'}),[1,2,63,64,65,4095,4096]);
 assert.deepEqual(featureValidationSizes({sizes:[1,4,16],scope:'allocation'}),[0,1,2,3,4,5,15,16]);
});
test('validation recomputes the source oracle and preserves destructive reset rules',()=>{
 const f=fixtures().find(f=>f.feature==='core-mem'&&f.name==='memory-grow');
 const w=featureValidationWorkload(f,0,{reset:f.reset,provenance:{}});
 assert.deepEqual(w.args,[0]);assert.deepEqual(w.oracle,{kind:'exact_u64',expected:[1]});
 assert.equal(w.reset,'fresh_instance_per_sample');assert.equal(w.provenance.validationOnly,true);
});
