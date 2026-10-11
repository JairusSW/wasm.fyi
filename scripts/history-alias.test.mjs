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
