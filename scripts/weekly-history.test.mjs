import test from 'node:test';import assert from 'node:assert/strict';
import {wednesdays,snapshotKey} from './lib/weekly-history.mjs';
import {engineSources} from './lib/engine-sources.mjs';
import {historyLanes} from './lib/history-lanes.mjs';
import {wasmerRelease,assertWasmerReceipt} from './lib/wasmer-release.mjs';
import {performanceHistoryQueue,performanceCorpusIdentity} from './lib/performance-history.mjs';
import {engineVersion,assertHistoricalRuntime} from './lib/historical-binding.mjs';
test('historical runtime evidence rejects current-SDK fallback and cached wazero compilation',()=>{
 const binding={engine:'wazero',version:'1.9.0',configuration:'wazero'};
 const runtime={id:'wazero',description:{runtime_version:'1.9.0',effective_configuration:{compile_policy:'fresh uncached module per operation; verification outside timer'}}};
 assert.doesNotThrow(()=>assertHistoricalRuntime(runtime,binding));
 assert.throws(()=>assertHistoricalRuntime({...runtime,description:{...runtime.description,runtime_version:'1.12.0'}},binding),/version differs/);
 assert.throws(()=>assertHistoricalRuntime({...runtime,description:{...runtime.description,effective_configuration:{compile_policy:'cached'}}},binding),/fresh compile/);
 const wago={engine:'wago',configuration:'wago',source:{revision:'a'.repeat(40)}};
 assert.doesNotThrow(()=>assertHistoricalRuntime({id:'wago',description:{runtime_version:'a'.repeat(40)+'/source-'+ 'b'.repeat(64)}},wago));
 assert.throws(()=>assertHistoricalRuntime({id:'wago',description:{runtime_version:'c'.repeat(40)+'/source-'+ 'b'.repeat(64)}},wago),/source differs/);
 assert.equal(engineVersion({tag:'v0.1.0-beta.11'}),'0.1.0-beta.11');assert.throws(()=>engineVersion({tag:'main'}),/explicit SDK version/);
});
test('performance history reuses released identities without changing collection dates',()=>{
 const base={engine:'wazero',status:'planned',repository:'tetratelabs/wazero',tag:'v1.12.0',publishedAt:'2026-09-01T00:00:00Z',configurations:['wazero']};
 const plan={pins:[{...base,targetWeek:'2026-09-23T00:00:00Z'},{...base,targetWeek:'2026-09-30T00:00:00Z'},
 {engine:'wago',status:'unavailable',targetWeek:'2025-10-01T00:00:00Z',reason:'No release'}]};
 const context={host:'darwin/arm64',corpusSha256:'a'.repeat(64),recipeSha256:'b'.repeat(64),options:{launches:6}};
 const queue=performanceHistoryQueue(plan,context);
 assert.equal(queue.jobs.length,1);assert.equal(queue.jobs[0].targetWeeks.length,2);
 assert.equal(queue.snapshots[2].status,'unavailable');assert(!('collectedAt' in queue.snapshots[0]));
 for(const key of Object.keys(context))assert.notEqual(queue.jobs[0].id,performanceHistoryQueue(plan,{...context,[key]:key.endsWith('Sha256')?'c'.repeat(64):key==='options'?{launches:3}:'linux/x64'}).jobs[0].id);
 assert.throws(()=>performanceHistoryQueue({pins:[plan.pins[0],plan.pins[0]]},context),/Duplicate engine/);
 assert.throws(()=>performanceHistoryQueue({pins:[{...plan.pins[0],publishedAt:'2026-10-01T00:00:00Z'}]},context),/Invalid released/);
 assert.throws(()=>performanceHistoryQueue({pins:[{...plan.pins[0],publishedAt:'invalid'}]},context),/Invalid released/);
 const newer={...base,tag:'v1.13.0',publishedAt:'2026-09-29T00:00:00Z',targetWeek:'2026-09-30T00:00:00Z'};
 assert.equal(performanceHistoryQueue({pins:[plan.pins[0],newer]},context).jobs[0].release.tag,'v1.13.0');
});
test('history corpus identity includes oracles and ABI and ignores host-specific artifact paths',()=>{
 const w={id:'applications/image-blur',sha256:'a'.repeat(64),artifact:'/mac/a.wasm',abi:'core',args:[192],reset:'stateless',oracle:{kind:'exact_u64',expected:['17']}};
 const id=performanceCorpusIdentity([w]);
 assert.equal(id,performanceCorpusIdentity([{...w,artifact:'/hub/a.wasm'}]));
 for(const key of ['abi','args','reset','oracle'])assert.notEqual(id,performanceCorpusIdentity([{...w,[key]:'changed'}]));
 assert.throws(()=>performanceCorpusIdentity([w,w]),/Duplicate history workload/);
});
test('Wasmer SDK selection requires the exact published source and binary receipt',()=>{
 const pin=wasmerRelease('7.4.2');
 const sha='a'.repeat(64);
 const receipt={version:pin.version,revision:pin.revision,librarySha256:sha,llvm:{version:'22.1.8'}};
 assert.doesNotThrow(()=>assertWasmerReceipt(receipt,pin,sha));
 for(const key of ['version','revision','librarySha256'])assert.throws(()=>assertWasmerReceipt({...receipt,[key]:'wrong'},pin,sha),/pinned build manifest/);
 assert.throws(()=>assertWasmerReceipt({...receipt,llvm:{version:'21.1.0'}},pin,sha),/unexpected LLVM/);
 assert.throws(()=>wasmerRelease('main'),/Unqualified/);
 assert.throws(()=>assertWasmerReceipt(receipt,wasmerRelease('7.3.0'),sha),/pinned build manifest/);
 assert.equal(wasmerRelease().version,'7.3.0');
});
test('history before the first Wago release continues with released engines',()=>{
 const targetWeek='2025-10-01T00:00:00.000Z';
 const pins=[{engine:'wago',targetWeek,status:'unavailable',reason:'No published release'},
 {engine:'wasmtime',targetWeek,status:'planned',tag:'v37.0.0'},
 {engine:'wazero',targetWeek,status:'planned',tag:'v1.9.0'}];
 const {lanes,gaps}=historyLanes(pins,targetWeek,'linux');
 assert.deepEqual(lanes,['wasmtime-core','winch-core','wasmtime-component','wasmtime-wasi']);
 assert.equal(gaps[0].status,'unavailable');assert.equal(gaps[0].reason,'No published release');
 assert.equal(gaps[1].status,'uncollected');
});
test('released Wago gets official WASI on Linux and an explicit Mac gap',()=>{
 const targetWeek='2026-09-30T00:00:00.000Z';
 const pins=[{engine:'wago',targetWeek,status:'planned',tag:'v0.1.0-beta.11'}];
 assert.deepEqual(historyLanes(pins,targetWeek,'linux'),{lanes:['wago-core','wago-component','wago-wasi'],gaps:[]});
 const mac=historyLanes(pins,targetWeek,'darwin');
 assert.deepEqual(mac.lanes,['wago-core','wago-component']);assert.equal(mac.gaps[0].scope,'wasi');
 assert.equal(historyLanes(pins,'2025-10-01T00:00:00.000Z','linux').lanes.length,0);
});
test('Wednesday boundaries are UTC, include the latest Wednesday and catch every missed week',()=>{
  assert.deepEqual(wednesdays(new Date('2026-10-01T19:00:00Z'),2),['2026-09-23T00:00:00.000Z','2026-09-30T00:00:00.000Z']);
  assert.equal(wednesdays(new Date('2026-09-30T23:59:59Z'),1)[0],'2026-09-30T00:00:00.000Z');
  assert.equal(wednesdays(new Date('2026-09-29T23:59:59Z'),1)[0],'2026-09-23T00:00:00.000Z');
  const dates=wednesdays(new Date('2026-10-15T00:00:00Z'),2,[{targetWeek:'2026-09-23T00:00:00Z'}]);
  assert.equal(dates.length,4);assert(dates.every(d=>new Date(d).getUTCDay()===3));
});
test('reuse identity includes source, host, corpus, recipe, options and configuration',()=>{
  const input={engine:'wago',revision:'a'.repeat(40),suiteSha256:'b'.repeat(64),recipeSha256:'c'.repeat(64),host:'darwin/arm64',configurations:['wago'],options:{samples:3}};
  for(const key of Object.keys(input))assert.notEqual(snapshotKey(input),snapshotKey({...input,[key]:'changed'}));
});
test('all fourteen engines have explicit release sources and configurations',()=>{
  assert.equal(Object.keys(engineSources).length,14);
  for(const source of Object.values(engineSources)){assert(source.repository.includes('/'));assert(!source.branch);assert(source.configurations.length);}
});
test('a full year includes both Wednesday endpoints, 52 weekly intervals',()=>{
 const dates=wednesdays(new Date('2026-10-02T00:00:00Z'),53);
 assert.equal(dates.length,53);assert.equal(dates[0],'2025-10-01T00:00:00.000Z');assert.equal(dates.at(-1),'2026-09-30T00:00:00.000Z');
});
