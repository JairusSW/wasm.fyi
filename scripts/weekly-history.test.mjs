import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {featureConfigurations} from './lib/feature-configurations.mjs';
import {saturdays,monthsBefore,snapshotKey,weeklyPolicy} from './lib/weekly-history.mjs';
import {engineSources} from './lib/engine-sources.mjs';
import {historyLanes} from './lib/history-lanes.mjs';
import {wasmerRelease,assertWasmerReceipt} from './lib/wasmer-release.mjs';
import {performanceHistoryQueue,performanceCorpusIdentity} from './lib/performance-history.mjs';
import {engineVersion,assertHistoricalRuntime,pendingBindingReason} from './lib/historical-binding.mjs';
test('historical runtime evidence rejects current-SDK fallback and cached wazero compilation',()=>{
 const binding={engine:'wazero',version:'1.9.0',configuration:'wazero'};
 const runtime={id:'wazero',description:{runtime_version:'1.9.0',effective_configuration:{compile_policy:'fresh uncached module per operation; verification outside timer'}}};
 assert.doesNotThrow(()=>assertHistoricalRuntime(runtime,binding));
 assert.throws(()=>assertHistoricalRuntime({...runtime,description:{...runtime.description,runtime_version:'1.12.0'}},binding),/version differs/);
 assert.throws(()=>assertHistoricalRuntime({...runtime,description:{...runtime.description,effective_configuration:{compile_policy:'cached'}}},binding),/fresh compile/);
 const wago={engine:'wago',configuration:'wago',source:{revision:'a'.repeat(40)}};
 assert.doesNotThrow(()=>assertHistoricalRuntime({id:'wago',description:{runtime_version:'a'.repeat(40)+'/source-'+ 'b'.repeat(64)}},wago));
 assert.throws(()=>assertHistoricalRuntime({id:'wago',description:{runtime_version:'c'.repeat(40)+'/source-'+ 'b'.repeat(64)}},wago),/source differs/);
 const wasmer={engine:'wasmer',configuration:'wasmer-singlepass',version:'7.5.0'};
 assert.doesNotThrow(()=>assertHistoricalRuntime({id:'wasmer-singlepass',description:{runtime_version:'7.5.0',backend:'singlepass-jit'}},wasmer));
 assert.throws(()=>assertHistoricalRuntime({id:'wasmer-singlepass',description:{runtime_version:'7.5.0',backend:'cranelift'}},wasmer),/Singlepass/);
 const wavm={engine:'wavm',configuration:'wavm',source:{adapterVersion:'nightly-2026-04-05-4e82bb9'}};
 assert.doesNotThrow(()=>assertHistoricalRuntime({id:'wavm',description:{runtime_version:wavm.source.adapterVersion}},wavm));
 const spider={engine:'spidermonkey',configuration:'spidermonkey',source:{binarySha256:'d'.repeat(64)}};
 const spiderRuntime={id:'spidermonkey',description:{build:'binary-sha256:'+spider.source.binarySha256,effective_configuration:{wasm_compiler:'Ion only',flags:'--wasm-compiler=ion'}}};
 assert.doesNotThrow(()=>assertHistoricalRuntime(spiderRuntime,spider));
 assert.throws(()=>assertHistoricalRuntime({...spiderRuntime,description:{...spiderRuntime.description,effective_configuration:{wasm_compiler:'Baseline'}}},spider),/forced Ion/);
 const jsc={engine:'jsc',configuration:'jsc',version:'2.54.1',source:{binarySha256:'e'.repeat(64)}};
 const jscRuntime={id:'jsc',description:{runtime_version:'WebKitGTK/2.54.1',build:'binary-sha256:'+jsc.source.binarySha256,backend:'OMG (forced tier-up)'}};
 assert.doesNotThrow(()=>assertHistoricalRuntime(jscRuntime,jsc));
 assert.throws(()=>assertHistoricalRuntime({...jscRuntime,description:{...jscRuntime.description,build:'binary-sha256:'+'f'.repeat(64)}},jsc),/binary identity/);
 assert.throws(()=>assertHistoricalRuntime({...jscRuntime,description:{...jscRuntime.description,backend:'production-default-tiering'}},jsc),/forced OMG/);
 assert.equal(engineVersion({engine:'spidermonkey',tag:'157.0'}),'157.0');
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
test('weekly and per-release targets reuse one measurement job for the same released engine',()=>{
 const release={engine:'wazero',repository:'tetratelabs/wazero',tag:'v1.12.0',publishedAt:'2026-09-01T00:00:00Z',configurations:['wazero'],status:'planned'};
 const plan={pins:[{...release,targetType:'weekly',targetWeek:'2026-09-05T00:00:00.000Z'}],
   releasePins:[{...release,targetType:'release',targetRelease:'v1.12.0',targetWeek:release.publishedAt}]};
 const queue=performanceHistoryQueue(plan,{host:'darwin/arm64',corpusSha256:'a'.repeat(64),recipeSha256:'b'.repeat(64),options:{samples:3}});
 assert.equal(queue.jobs.length,1);assert.equal(queue.jobs[0].targetWeeks.length,1);
 assert.deepEqual(queue.jobs[0].targetReleases,[{tag:'v1.12.0',publishedAt:release.publishedAt}]);
 assert.equal(queue.snapshots[0].jobId,queue.snapshots[1].jobId);
});
test('Saturday main pins and release pins are separate source identities',()=>{
 const main={engine:'wazero',targetType:'main',targetWeek:'2026-09-05T00:00:00.000Z',repository:'tetratelabs/wazero',branch:'main',revision:'a'.repeat(40),configurations:['wazero'],status:'planned'};
 const release={engine:'wazero',targetType:'release',targetWeek:'2026-09-05T00:00:00.000Z',targetRelease:'v1.12.0',repository:'tetratelabs/wazero',tag:'v1.12.0',publishedAt:'2026-09-01T00:00:00Z',configurations:['wazero'],status:'planned'};
 const context={host:'darwin/arm64',corpusSha256:'a'.repeat(64),recipeSha256:'b'.repeat(64),options:{samples:1}};
 const queue=performanceHistoryQueue({pins:[main],releasePins:[release]},context);
 assert.equal(queue.jobs.length,2);assert(queue.snapshots.every(s=>s.status==='pending'));
 assert.equal(queue.jobs.find(j=>j.source.targetType==='main').identity.revision,'a'.repeat(40));
 assert.equal(queue.jobs.find(j=>j.source.targetType==='release').identity.tag,'v1.12.0');
 assert.throws(()=>performanceHistoryQueue({pins:[{...main,revision:'main'}]},context),/default-branch/);
});
test('mainline measurements stay pending until an exact-revision build binding is qualified',()=>{
 assert.match(pendingBindingReason({targetType:'main',engine:'wago',revision:'a'.repeat(40)}),/source-revision performance build binding/);
 assert.equal(pendingBindingReason({targetType:'release',engine:'wago',tag:'v0.1.0-beta.11'}),null);
});
test('history policy records Saturday main tracking and distinct main/release chart styling',()=>{
 assert.match(weeklyPolicy,/Saturday 11:59 PM America\/New_York/);
 assert.match(weeklyPolicy,/default-branch commit for weekly main tracking/);
 assert.match(weeklyPolicy,/dimmed trend line; individually released versions are bold history points/);
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
test('Saturday boundaries are Eastern, include the latest completed Saturday and catch every missed week',()=>{
  assert.deepEqual(saturdays(new Date('2026-10-04T19:00:00Z'),2),['2026-09-27T03:59:00.000Z','2026-10-04T03:59:00.000Z']);
  assert.equal(saturdays(new Date('2026-10-03T23:59:59Z'),1)[0],'2026-09-27T03:59:00.000Z');
  assert.equal(saturdays(new Date('2026-10-02T23:59:59Z'),1)[0],'2026-09-27T03:59:00.000Z');
  const dates=saturdays(new Date('2026-10-17T00:00:00Z'),2,[{targetWeek:'2026-09-26T00:00:00Z'}]);
  assert.deepEqual(dates,['2026-09-27T03:59:00.000Z','2026-10-04T03:59:00.000Z','2026-10-11T03:59:00.000Z']);
});
test('four-month release window uses calendar months and is independent of Saturday snapshots',()=>{
  assert.equal(monthsBefore(new Date('2026-10-03T12:00:00Z'),4),'2026-06-03T12:00:00.000Z');
  assert.equal(monthsBefore(new Date('2026-05-31T00:00:00Z'),3),'2026-02-28T00:00:00.000Z');
});
test('reuse identity includes source, host, corpus, recipe, options and configuration',()=>{
  const input={engine:'wago',revision:'a'.repeat(40),suiteSha256:'b'.repeat(64),recipeSha256:'c'.repeat(64),host:'darwin/arm64',configurations:['wago'],options:{samples:3}};
  for(const key of Object.keys(input))assert.notEqual(snapshotKey(input),snapshotKey({...input,[key]:'changed'}));
});
test('all release-capable benchmark configurations have explicit release sources',()=>{
	assert.equal(Object.values(engineSources).reduce((n,source)=>n+source.configurations.length,0),14);
  for(const source of Object.values(engineSources)){assert(source.repository.includes('/'));assert(!source.branch);assert(source.configurations.length);}
});
test('both measured hosts select only the six supported configurations',()=>{
 const settings=JSON.parse(readFileSync(new URL('../wasmbench.config.json',import.meta.url)));
 const expected=['wasmtime','v8','wasmer-singlepass','wazero','wavm','wago'].sort();
 for(const platform of ['darwin','linux'])assert.deepEqual(featureConfigurations(settings,platform).sort(),expected);
});
test('default collection sample counts prioritize compile, instantiate and steady latency',()=>{
 const settings=JSON.parse(readFileSync(new URL('../wasmbench.config.json',import.meta.url)));
 assert.equal(settings.collection.scenarioSamples.compile,3);
 assert.equal(settings.collection.scenarioSamples.instantiate,3);
 assert.equal(settings.collection.scenarioSamples['first-call'],1);
 assert.equal(settings.collection.scenarioSamples.steady,3);
 assert.equal(settings.collection.scenarioSamples['*'],1);
});
test('the four-month history window includes every Saturday and catches up weekly',()=>{
 const dates=saturdays(new Date('2026-10-04T19:00:00Z'),18);
 assert.equal(dates.length,18);assert.equal(dates[0],'2026-06-07T03:59:00.000Z');assert.equal(dates.at(-1),'2026-10-04T03:59:00.000Z');
});


import {alignHistoryDates,historyDate} from './lib/history-align.mjs';
test('aligns different host dates with gaps and preserves original evidence objects',()=>{
 const old={date:'2026-09-26',revision:'old',status:'measured'},newer={date:'2026-10-03',revision:'new',status:'measured'};
 const a={st:'ok',report:'arm-old',v:1},b={st:'ok',report:'amd-new',v:2};
 const h={arm:{points:[old,newer],cells:{exec:[a,a]},versions:{wago:['old','new']}},amd:{points:[newer],cells:{exec:[b]},versions:{wago:['new']}}};
 alignHistoryDates(h);
 assert.deepEqual(h.amd.points[0],{date:'2026-09-26',revision:'',status:'not-collected'});
 assert.equal(h.amd.cells.exec[0].st,'nm');assert.equal(h.amd.cells.exec[0].report,'');assert.equal(h.amd.versions.wago[0],'not collected');
 assert.equal(h.amd.points[1],newer);assert.equal(h.amd.cells.exec[1],b);assert.equal(h.arm.cells.exec[0],a);
 const once=structuredClone(h);alignHistoryDates(h);assert.deepEqual(h,once);
});

test('labels late Eastern Saturday cutoffs by their local calendar date',()=>{
 assert.equal(historyDate('2026-09-27T03:59:00Z'),'2026-09-26');
 assert.equal(historyDate('2026-10-03T23:59:00-04:00'),'2026-10-03');
 assert.equal(historyDate('2026-09-29T14:07:11-04:00'),'2026-09-29');
 assert.equal(historyDate('2026-09-26'),'2026-09-26');
});

import {stageCollectionBundles} from './lib/stage-collection-bundles.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {digest} from './lib/wasmbench.mjs';
test('staged committed bundles preserve hashes and use immutable archive URLs; unpublished bundles stay local',async()=>{
 const root=await mkdtemp(join(tmpdir(),'history-archives-'));
 try{
  const source=join(root,'source'),bundle=join(source,'weekly-test/local/bundle');await mkdir(bundle,{recursive:true});
  const part=Buffer.from('sealed archive bytes'),metadata=JSON.stringify({planSha256:'pinned-plan'}),index={schema:1,id:'weekly-test',machine:'local',bytes:part.length,sha256:digest(part),parts:[{path:'bundle.tar.gz.part-000',bytes:part.length,sha256:digest(part)}],metadata:'metadata.json',metadataSha256:digest(metadata)};
  const original=JSON.stringify(index);await writeFile(join(bundle,'index.json'),original);await writeFile(join(bundle,'metadata.json'),metadata);await writeFile(join(bundle,index.parts[0].path),part);
  const target=join(root,'published');await stageCollectionBundles(source,target,{archiveBaseUrl:'https://raw.githubusercontent.com/org/repo/'+ 'a'.repeat(40)+'/data/benchmark-runs/',committed:async(path,bytes)=>path==='weekly-test/local/bundle/index.json'&&bytes.toString()===original});
  const published=join(target,'weekly-test/local/bundle'),projection=JSON.parse(await readFile(join(published,'index.json')));
  assert.equal(projection.parts[0].url,'https://raw.githubusercontent.com/org/repo/'+ 'a'.repeat(40)+'/data/benchmark-runs/weekly-test/local/bundle/bundle.tar.gz.part-000');
  assert.equal(projection.sha256,index.sha256);assert.equal(projection.parts[0].sha256,index.parts[0].sha256);assert.equal(projection.sourceIndexSha256,digest(original));assert.equal((await readFile(join(published,'source-index.json'))).toString(),original);
  await assert.rejects(access(join(published,index.parts[0].path)));
  const local=join(root,'local');await stageCollectionBundles(source,local,{archiveBaseUrl:'https://raw.githubusercontent.com/org/repo/main/',committed:async()=>false});
  assert.deepEqual(await readFile(join(local,'weekly-test/local/bundle',index.parts[0].path)),part);
  await writeFile(join(bundle,index.parts[0].path),'tampered');await assert.rejects(stageCollectionBundles(source,join(root,'tampered')),{message:'Parent archive part digest mismatch'});
 }finally{await rm(root,{recursive:true,force:true});}
});
