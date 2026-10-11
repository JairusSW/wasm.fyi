import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {historyWorkloadFailure} from './lib/history-workload-failure.mjs';
import {reusableCapture} from './lib/history-scope.mjs';

const workload={id:'wago/coremark/2k-performance',sha256:'a'.repeat(64),artifactName:'coremark.wasm',abi:'core',export:'run',oracle:{expected:['1']}};
const source={repository:'tetratelabs/wazero',revision:'b'.repeat(40),kind:'snapshot',ref:'main@bbbbbbbb',asOf:'2026-10-09T08:07:55.636Z'};
const job={engine:'wazero-interpreter',source};
const platform={os:'linux',arch:'amd64',cpu:'AMD Ryzen 9 5950X',cores:8,kernel:'Linux',memoryBytes:1};

test('an expired workload budget produces terminal reusable zero-sample rows and durable timeout provenance',async()=>{
 const signal=AbortSignal.timeout(1);await delay(5);
 const error=new Error('Capture infrastructure failure: producer output incomplete',{cause:signal.reason});
 const {capture,note}=historyWorkloadFailure({workload,job,platform,error,signal,capturedAt:'2026-10-09T20:00:00.000Z'});
 assert.equal(note.kind,'timeout');assert.equal(note.budgetMs,300000);
 assert.equal(note.reason,String(error));assert.match(note.causes[1],/^TimeoutError:/);
 assert.equal(capture.capturedAt,note.capturedAt);
 assert.deepEqual(capture.results.map(row=>row.phase),['compile','instantiate','first-call','steady']);
 assert.ok(capture.results.every(row=>row.latencyStatus==='failed'&&row.timingSamples===0&&row.latencyNs===null));
 assert.ok(reusableCapture(capture,workload,source,5,{method:'same-process-stability-v1'}));
 assert.ok(!reusableCapture(capture,{...workload,sha256:'c'.repeat(64)},source,5,{}));
 assert.ok(!reusableCapture(capture,workload,{...source,revision:'c'.repeat(40)},5,{}));
 assert.equal(capture.failure,undefined); // API schema remains unchanged.
});

test('correctness/transport exceptions retain their cause without becoming a workload timeout',()=>{
 const {note}=historyWorkloadFailure({workload,job,platform,error:new Error('incorrect result'),signal:new AbortController().signal});
 assert.equal(note.kind,'capture-error');assert.equal(note.reason,'Error: incorrect result');
});
