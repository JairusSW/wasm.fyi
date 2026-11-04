import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertCapturedOutcome} from './lib/capture-audit-outcome.mjs';
test('coverage excludes unmeasured infrastructure placeholders but retains runtime outcomes',()=>{
 const failed={results:[{latencyStatus:'failed',latencyNs:null}]};
 assert.throws(()=>assertCapturedOutcome(failed,{kind:'capture-error',reason:'missing adapter'}),/Unresolved capture infrastructure/);
 for(const kind of ['timed-out','guest-fatal','failed-trials'])assert.doesNotThrow(()=>assertCapturedOutcome(failed,{kind}));
 assert.doesNotThrow(()=>assertCapturedOutcome({results:[{latencyStatus:'ok',latencyNs:1,samplesNs:[1]}]},{kind:'capture-error'}));
});
