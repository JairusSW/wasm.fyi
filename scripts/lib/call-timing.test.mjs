import test from 'node:test';
import assert from 'node:assert/strict';
import { callTimingCandidates } from './call-timing.mjs';
import {callBatchOperations,CALL_LOOP_WORKLOAD} from './call-timing.mjs';

test('explicit collection batch operations remain visible and never change guest-loop invocation count',()=>{
 const boundary={id:'mechanisms/host-to-wasm-call'};
 assert.equal(callBatchOperations(boundary),1000000);
 assert.equal(callBatchOperations(boundary,{callBatchOperations:10000}),10000);
 assert.equal(callBatchOperations({id:CALL_LOOP_WORKLOAD},{callBatchOperations:10000}),1);
 for(const value of [0,1000001,1.5,'10000'])assert.throws(()=>callBatchOperations(boundary,{callBatchOperations:value}),/Invalid explicit/);
});

test('Redline bounds public-call batches without changing guest-loop work or other engines',()=>{
 const boundary={id:'mechanisms/host-to-wasm-call'};
 assert.equal(callBatchOperations(boundary,{},['endive-redline']),100);
 assert.equal(callBatchOperations(boundary,{callBatchOperations:17},['endive-redline']),17);
 for(const engine of ['endive-interpreter','endive-jit','v8'])assert.equal(callBatchOperations(boundary,{},[engine]),1000000);
 assert.equal(callBatchOperations({id:CALL_LOOP_WORKLOAD},{},['endive-redline']),1);
});

test('whole-corpus single calls do not replace dedicated boundary-call batches', () => {
  const single = {options:{operations:1}};
  const failedBatch = {options:{operations:1000000},status:'failed'};
  const batch = {options:{operations:1000000},status:'ok'};
  const reports = [single,failedBatch,batch];
  assert.deepEqual(callTimingCandidates(reports,'mechanisms/host-to-wasm-call','steady'),[failedBatch,batch]);
  assert.deepEqual(callTimingCandidates(reports,'mechanisms/wasm-to-host-call','steady'),[failedBatch,batch]);
  assert.deepEqual(callTimingCandidates([single],'mechanisms/host-to-wasm-call','steady'),[single]);
  assert.equal(callTimingCandidates(reports,'mechanisms/host-to-wasm-call','compile'),reports);
  assert.equal(callTimingCandidates(reports,'applications/image-blur','steady'),reports);
});

test('guest-loop batches use one outer invocation and increase work when any batch is below 0.5 ms',async()=>{
 const {collectCallBatches,callBatchOperations,CALL_LOOP_WORKLOAD}=await import('./call-timing.mjs');
 assert.equal(callBatchOperations({id:CALL_LOOP_WORKLOAD}),1);
 const attempted=[];
 const out=await collectCallBatches({directory:'/tmp',prefix:'calibration',operations:1,run:async(out,ops)=>attempted.push(ops),verify:async()=>{},load:async()=>[{block:0,status:'ok',profile:'timing',scenario:'steady',samples:[{verified:true,warmup:true,operations:attempted.at(-1),elapsed_ns:attempted.length===1?300000:800000},{verified:true,operations:attempted.at(-1),elapsed_ns:900000}]}]});
 assert.deepEqual(attempted,[1,3]);assert.match(out,/call-timing-1$/);
});

test('short call batches fail closed at the protocol operation limit',async()=>{
 const {collectCallBatches}=await import('./call-timing.mjs');
 await assert.rejects(()=>collectCallBatches({directory:'/tmp',prefix:'short',operations:1000000,run:async()=>{},verify:async()=>{},load:async()=>[{block:0,status:'ok',profile:'timing',scenario:'steady',samples:[{verified:true,operations:1000000,elapsed_ns:499999}]}]}),/did not reach 0.5 ms/);
});
