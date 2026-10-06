import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalCoverageRecords,retainUncollectedHistoryConfiguration} from './lib/performance-history-coverage.mjs';
import {digest} from './lib/wasmbench.mjs';
const hash=value=>digest(Buffer.from(value));
function fixture(){const release={engine:'wasmtime',targetType:'weekly',repository:'bytecodealliance/wasmtime',tag:'v40.0.0',publishedAt:'2026-10-01T12:00:00Z',datePrecision:'second',url:'https://github.com/bytecodealliance/wasmtime/releases/tag/v40.0.0'};return {queue:{host:'darwin/arm64',corpusSha256:hash('contracts'),recipeSha256:hash('recipe'),jobs:[{id:hash('job'),release,identity:{configurations:['wasmtime','wasmtime-lightbeam']},targetWeeks:['2026-10-03','2026-10-10'],targetReleases:[{publishedAt:release.publishedAt}]}],snapshots:[{engine:'wago',status:'unavailable',targetType:'weekly',targetWeek:'2026-10-03',reason:'No released build at cutoff'}]},ledger:{jobs:[]},configured:['wasmtime']}}
test('publication-only replay preserves recorded unavailable and failed collector states',()=>{
 for(const status of ['pending-binding','unavailable','runner-error','building','running','not-collected']){const previous={id:'wasmtime',status,reason:'Original outcome',attempt:'/private/attempt',binding:{source:{revision:'a'.repeat(40)}}};const retained=retainUncollectedHistoryConfiguration(previous,'wasmtime');assert.deepEqual(retained,previous);retained.binding.source.revision='changed';assert.equal(previous.binding.source.revision,'a'.repeat(40))}
 assert.equal(retainUncollectedHistoryConfiguration(undefined,'wasmtime').status,'not-collected');assert.throws(()=>retainUncollectedHistoryConfiguration({id:'wasmtime',status:'collected'},'wasmtime'));assert.throws(()=>retainUncollectedHistoryConfiguration({id:'wasmtime',status:'unsupported'},'wasmtime'));
});
test('history coverage retains missing targets and configured scope without manufactured points',()=>{
 const rows=[...historicalCoverageRecords(fixture())];assert.equal(rows.length,3);
 assert.deepEqual(rows[0].data.targetDates,['2026-10-01','2026-10-03','2026-10-10']);assert.equal(rows[0].data.status,'uncollected');assert.equal(rows[0].data.recordedStatus,null);assert.equal(rows[0].data.configured,true);
 assert.equal(rows[1].data.configured,false);assert.equal(rows[2].data.status,'unavailable');assert.equal(rows[2].data.configuration,null);assert.equal(rows[2].data.configured,null);assert.equal(rows[2].data.jobId,null);
 for(const row of rows){assert.equal(row.kind,'history-coverage');assert.equal(row.data.sourceReportSha256,null);assert.equal(row.data.collectedAt,null);assert.equal(row.data.publishedRevision,null);assert(!('summary' in row.data));assert(!('median' in row.data));assert(Buffer.byteLength(JSON.stringify(row))<10*1024)}
});
test('reused historical evidence remains one coverage cell with independent desired/observed identities',()=>{
 const input=fixture(),job=input.queue.jobs[0],entry={id:'wasmtime',status:'collected',sha256:hash('source'),collectedAt:'2026-10-06T12:00:00Z',report:'/private/report',binding:{source:{revision:'a'.repeat(40)}},apiPublication:{status:'published',revision:hash('revision')}};input.ledger.jobs=[{id:job.id,configurations:[entry]}];
 const collected=[...historicalCoverageRecords(input)][0];assert.equal(collected.data.desiredBuild.revision,null);assert.equal(collected.data.observedSourceRevision,'a'.repeat(40));assert.equal(collected.data.sourceReportSha256,entry.sha256);assert.equal(collected.data.publishedRevision,entry.apiPublication.revision);assert(!JSON.stringify(collected).includes('/private'));
 const reversed=structuredClone(input);reversed.queue.jobs[0].targetWeeks.reverse();assert.deepEqual([...historicalCoverageRecords(reversed)][0],collected);
 const before=[...historicalCoverageRecords(fixture())][0];assert.equal(before.data.coverageId,collected.data.coverageId);assert.notEqual(before.id,collected.id);
});
test('history coverage rejects ambiguous ledgers and invented source identities',()=>{
 for(const mutate of [x=>x.ledger.jobs=[{id:x.queue.jobs[0].id,configurations:[{id:'wasmtime',status:'collected'}]}],x=>x.queue.jobs.push(x.queue.jobs[0]),x=>x.queue.jobs[0].targetWeeks=['2026-02-30'],x=>x.ledger.jobs=[{id:x.queue.jobs[0].id,configurations:[{id:'wasmtime',status:'unsupported'}]}],x=>x.queue.snapshots.push(x.queue.snapshots[0])]){const input=fixture();mutate(input);assert.throws(()=>[...historicalCoverageRecords(input)])}
});


test('an unavailable named release retains unknown date and configuration',()=>{
 const input=fixture();input.queue.snapshots=[{engine:'wasmtime',status:'unavailable',targetType:'release',targetRelease:'v999.0.0',reason:'Release receipt unavailable'}];
 const row=[...historicalCoverageRecords(input)].at(-1);assert.equal(row.data.targetRelease,'v999.0.0');assert.deepEqual(row.data.targetDates,[]);assert.equal(row.data.configuration,null);assert.equal(row.data.desiredBuild.releaseDate,null);assert.equal(row.data.sourceReportSha256,null);
});

test('source targets retain desired and actual revisions without a release marker',()=>{
 const input=fixture();input.queue.jobs[0].release={engine:'wago',targetType:'main',repository:'JairusSW/wago',revision:'a'.repeat(40),committedAt:'2026-10-01T12:00:00Z'};input.queue.jobs[0].identity.configurations=['wago'];input.configured=['wago'];input.queue.jobs[0].targetReleases=[];
 input.ledger.jobs=[{id:input.queue.jobs[0].id,configurations:[{id:'wago',status:'collected',sha256:hash('source'),collectedAt:'2026-10-06T12:00:00Z',binding:{source:{revision:'b'.repeat(40)}}}]}];
 const row=[...historicalCoverageRecords(input)][0];assert.equal(row.data.desiredBuild.role,'source');assert.equal(row.data.desiredBuild.revision,'a'.repeat(40));assert.equal(row.data.desiredBuild.sourceDate,'2026-10-01T12:00:00Z');assert.equal(row.data.desiredBuild.version,null);assert.equal(row.data.desiredBuild.releaseDate,null);assert.equal(row.data.observedSourceRevision,'b'.repeat(40));assert.equal(row.data.publishedRevision,null);
});
