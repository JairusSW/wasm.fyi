import test from 'node:test';
import assert from 'node:assert/strict';
import {aliasCapture} from './lib/history-alias.mjs';
test('weekly aliases preserve samples and measured timestamp while changing weekly provenance',()=>{
 const capture={capturedAt:'measured',source:{repository:'org/sdk',revision:'abc',asOf:'new-week',kind:'release',ref:'v1',dateBasis:'tag'},results:[{engine:'sdk',samplesNs:[10,20]}]};
 const pin={status:'reused',repository:'org/sdk',revision:'abc',reuseTargetWeek:'new-week',targetWeek:'old-week',configurations:['sdk']};
 const copy=aliasCapture(capture,pin);
 assert.equal(copy.capturedAt,capture.capturedAt);assert.equal(copy.results,capture.results);
 assert.equal(copy.source.asOf,'old-week');assert.equal(copy.source.kind,'snapshot');assert.equal(copy.source.dateBasis,undefined);
 assert.equal(capture.source.asOf,'new-week');
 for(const mismatch of [{revision:'different'},{repository:'other'},{reuseTargetWeek:'other'},{configurations:['other']},{status:'planned'}])assert.equal(aliasCapture(capture,{...pin,...mismatch}),null);
});
test('feature compatibility and performance stay latest-only even when weekly source hashes match',()=>{
 const pin={status:'reused',repository:'org/sdk',revision:'a'.repeat(40),reuseTargetWeek:'2026-10-15T07:33:48.082Z',targetWeek:'2026-10-04T10:00:00.000Z',configurations:['sdk']};
 const main={capturedAt:'2026-10-15T12:00:00Z',source:{repository:pin.repository,revision:pin.revision,asOf:pin.reuseTargetWeek},results:[{engine:'sdk',workload:'applications/add',samplesNs:[10,20]}]};
 assert.notEqual(aliasCapture(main,pin),null);
 for(const workload of ['features/compact-imports/type-group/1','features/mvp/numeric/perf']){
  const feature={...main,results:[{...main.results[0],workload}]};
  assert.equal(aliasCapture(feature,pin),null);
  assert.equal(aliasCapture({...feature,featureCompatibility:true},pin),null);
  assert.equal(aliasCapture({...main,results:[...main.results,...feature.results]},pin),null);
 }
});
