import test from 'node:test';
import assert from 'node:assert/strict';
import {retryInfrastructureCapture} from './lib/resumed-workload-failure.mjs';
const job={engine:'wasm2go',source:{revision:'revision',asOf:'week'},retryInfrastructureFailurePolicy:'private-harness-v1'},workload={id:'workload'};
const note={engine:job.engine,source:job.source,workload:workload.id,kind:'capture-error'};
const capture={results:[{latencyStatus:'failed',timingSamples:0,latencyNs:null}]};
test('a new binding policy recovers an unmeasured infrastructure outcome exactly once',()=>{
 assert.equal(retryInfrastructureCapture(capture,note,job,workload),true);
 assert.equal(retryInfrastructureCapture(capture,{...note,recoveryPolicy:job.retryInfrastructureFailurePolicy},job,workload),false);
});
test('recovery never replaces measured phases or retries guest failures, timeouts or another source',()=>{
 for(const change of [{kind:'failed-trials'},{kind:'timed-out'},{source:{...job.source,revision:'another'}},{workload:'another'}])assert.equal(retryInfrastructureCapture(capture,{...note,...change},job,workload),false);
 for(const row of [{latencyStatus:'ok',timingSamples:5,latencyNs:42},{latencyStatus:'failed',timingSamples:5,samplesNs:[42],latencyNs:null}])assert.equal(retryInfrastructureCapture({results:[row]},note,job,workload),false);
 assert.equal(retryInfrastructureCapture(capture,note,{...job,retryInfrastructureFailurePolicy:undefined},workload),false);
});
test('W2C2 retries the missing SIMDe adapter configuration without retrying other compiler errors',()=>{
 const w2c2={...job,engine:'w2c2-gcc'};
 const missing={...note,engine:w2c2.engine,kind:'failed-trials',failures:[{status:'error',reason:'native_compile failed: SIMD output requires SIMDe. Define W2C2_SIMDE_HEADER'}]};
 assert.equal(retryInfrastructureCapture(capture,missing,w2c2,workload),true);
 assert.equal(retryInfrastructureCapture(capture,{...missing,failures:[{status:'error',reason:'unrelated compiler failure'}]},w2c2,workload),false);
 assert.equal(retryInfrastructureCapture(capture,{...missing,recoveryPolicy:w2c2.retryInfrastructureFailurePolicy},w2c2,workload),false);
});
