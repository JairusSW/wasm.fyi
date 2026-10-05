import test from 'node:test';
import assert from 'node:assert/strict';
import { callTimingCandidates } from './call-timing.mjs';

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
