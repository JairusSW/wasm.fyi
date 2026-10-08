import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retainedHistoryBindings} from './retained-history-bindings.mjs';
test('joins producer hashes to website IDs and preserves multi-engine reused dates',()=>{
 const report={oldId:'website-id',source:'producer-hash',run:'capture'};
 const engine={status:'measured',revision:'a'.repeat(40),source:{targetType:'main',committedAt:'2026-01-01T00:00:00Z'},reports:[{reportSha256:'producer-hash',runId:'capture-adapter'}]};
 const map=retainedHistoryBindings({results:[{targetWeek:'2026-01-04',engines:{wasmtime:engine,wazero:engine}},{targetWeek:'2026-01-11',engines:{wasmtime:engine}}]},[report]);
 assert.equal(map.has('producer-hash'),false);assert.equal(map.get('website-id').length,3);
 assert.deepEqual(map.get('website-id').map(x=>[x.runtime,x.date,x.role]),[['wasmtime','2026-01-04','source'],['wazero','2026-01-04','source'],['wasmtime','2026-01-11','source']]);
});
test('rejects missing or ambiguous producer references instead of silently dropping history',()=>{
 const weekly={results:[{targetWeek:'2026-01-04',engines:{wasmtime:{status:'measured',source:{targetType:'main'},reports:[{reportSha256:'producer',runId:'capture'}]}}}]};
 assert.throws(()=>retainedHistoryBindings(weekly,[]));
 assert.throws(()=>retainedHistoryBindings(weekly,[{source:'producer',run:'capture',oldId:'one'},{source:'producer',run:'capture',oldId:'two'}]));
});
test('retains legacy release points whose evidence was imported through the current snapshot',()=>{
 const report={oldId:'current-site-id',source:'producer',run:null};
 const result=retainedHistoryBindings({results:[{targetWeek:'2026-09-29T18:07:11Z',status:'measured',revision:'a'.repeat(40),version:'v0.1.0-beta.11',releasePublishedAt:'2026-09-29T18:07:11Z',reports:[{reportSha256:'producer',runId:'capture'}]}]},[report,{...report}]);
 assert.equal(result.get('current-site-id')[0].role,'release');
 assert.equal(result.get('current-site-id')[0].release.version,'v0.1.0-beta.11');
});
