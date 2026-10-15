import {workloadContract} from './lib/workload-contract.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {nearestCommit,nearestCommitSearchUntil,everyVersion,reusableCapture,validateHistoricalScope} from './lib/history-scope.mjs';
const bounds={cutoff:'2025-10-08T00:00:00Z',anchor:'2026-10-08T00:00:00Z'};
const commit=(day,key)=>({sha:key.repeat(40),commit:{committer:{date:day}}});
test('missing or ineligible earlier commits cut off history at the target',()=>{
 const target='2026-01-04T04:59:00Z';
 assert.equal(nearestCommitSearchUntil(undefined,target,bounds),target.replace('Z','.000Z'));
 assert.equal(nearestCommitSearchUntil(commit('2025-10-07T00:00:00Z','a'),target,bounds),target.replace('Z','.000Z'));
 assert.equal(nearestCommit([commit('2026-06-25T00:00:00Z','a')],target,bounds),undefined);
 assert.equal(nearestCommitSearchUntil(commit('2026-01-03T04:59:00Z','a'),target,bounds),'2026-01-05T04:59:01.000Z');
});
test('YTD snapshot dates can select a prior-year source that is still less than one year old',()=>{
 const target='2026-01-04T04:59:00Z',december=commit('2025-12-31T12:00:00Z','a'),later=commit('2026-01-12T12:00:00Z','b');
 assert.equal(nearestCommit([december,later],target,bounds),december);
});
test('chooses the closest Saturday-night commit in either direction, with earlier ties',()=>{const target='2026-10-04T03:59:00Z',before=commit('2026-10-04T03:30:00Z','a'),after=commit('2026-10-04T04:00:00Z','b');assert.equal(nearestCommit([before,after],target,bounds),after);assert.equal(nearestCommit([before,commit('2026-10-04T04:28:00Z','c')],target,bounds),before);assert.equal(nearestCommit([commit('2025-10-07T23:59:00Z','a')],bounds.cutoff,bounds),undefined)});
test('includes prereleases and snapshots as versions but stops at a year and excludes drafts',()=>{const releases=[{tag_name:'v1-beta',prerelease:true,published_at:'2026-01-01'},{tag_name:'nightly-1',published_at:'2026-02-01'},{tag_name:'v0',published_at:'2025-10-07'},{tag_name:'draft',published_at:'2026-01-01',draft:true}];assert.deepEqual(everyVersion(releases,bounds.cutoff,bounds.anchor).map(r=>r.tag_name),['nightly-1','v1-beta'])});
test('never reuses a three-sample or partial run for the five-sample request',()=>{const source={asOf:'2026-01-01',repository:'x/y',kind:'snapshot',revision:'a'},workload={sha256:'b'},capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>({phase,artifactSha256:'b',contractSha256:workloadContract(workload),latencyStatus:'ok',timingSamples:3}))};assert.equal(reusableCapture(capture,workload,source,5),false);for(const r of capture.results)r.timingSamples=5;assert.equal(reusableCapture(capture,workload,source,5),true);capture.results.pop();assert.equal(reusableCapture(capture,workload,source,5),false)});

test('twelve-sample jobs refuse previous five-sample captures',()=>{const source={asOf:'2026-01-01',repository:'x/y',kind:'snapshot',revision:'a'},workload={sha256:'b'},capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>({phase,artifactSha256:'b',contractSha256:workloadContract(workload),latencyStatus:'ok',timingSamples:5}))};assert.equal(reusableCapture(capture,workload,source,12),false);for(const r of capture.results)r.timingSamples=12;assert.equal(reusableCapture(capture,workload,source,12),true)});
test('versions sharing a commit and timestamp retain distinct source identities',()=>{
 const source={asOf:'2026-01-01',repository:'x/y',kind:'release',revision:'a',ref:'v1-beta.1',dateBasis:'go-module-commit'},workload={sha256:'b'};
 const capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>({phase,artifactSha256:'b',contractSha256:workloadContract(workload),latencyStatus:'ok',timingSamples:12}))};
 assert.equal(reusableCapture(capture,workload,source,12),true);
 assert.equal(reusableCapture(capture,workload,{...source,ref:'v1-canary'},12),false);
 assert.equal(reusableCapture(capture,workload,{...source,dateBasis:undefined},12),false);
});

test('startup failures with unknown versions are retried while recorded runtime failures are reused',()=>{
 const source={asOf:'2026-10-04',repository:'WasmEdge/WasmEdge',kind:'release',ref:'0.18.0',revision:'a'};
 const workload={sha256:'b'};
 const capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>({phase,artifactSha256:'b',contractSha256:workloadContract(workload),latencyStatus:'failed',version:'unknown'}))};
 assert.equal(reusableCapture(capture,workload,source,5),false);
 for(const row of capture.results)row.version='0.18.0';
 assert.equal(reusableCapture(capture,workload,source,5),true);
});

test('changing an oracle or execution input prevents result reuse',()=>{
 const source={asOf:'2026-01-01',repository:'x/y',kind:'snapshot',revision:'a'};
 const workload={id:'test',sha256:'b',initialize:'init',oracle:{expected:['1']}};
 const capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>({phase,artifactSha256:'b',contractSha256:workloadContract(workload),latencyStatus:'ok',timingSamples:5}))};
 assert.equal(reusableCapture(capture,workload,source,5),true);
 assert.equal(reusableCapture(capture,{...workload,initialize:'other'},source,5),false);
 assert.equal(reusableCapture(capture,{...workload,oracle:{expected:['2']}},source,5),false);
});

test('historical collectors fail closed for features, missing bounds, and invalid dates',()=>{
 const plan={anchor:'2026-10-09',cutoff:'2026-04-09',jobs:[{historical:true,source:{asOf:'2026-10-01'}}]};
 assert.doesNotThrow(()=>validateHistoricalScope(plan,[{id:'wago/tiny/add'}]));
 assert.throws(()=>validateHistoricalScope(plan,[{id:'features/core-num/add'}]),/excludes feature/);
 assert.throws(()=>validateHistoricalScope({...plan,cutoff:undefined},[]),/valid frozen/);
 assert.throws(()=>validateHistoricalScope({...plan,jobs:[{historical:true,source:{asOf:'invalid'}}]},[]),/outside requested/);
 assert.doesNotThrow(()=>validateHistoricalScope({jobs:[{historical:false}]},[{id:'features/core-num/add'}]));
});

test('grouped-sample runs never reuse fixed-policy samples or missing raw samples',()=>{
 const source={asOf:'2026-10-01',repository:'x/y',kind:'snapshot',revision:'a'},workload={id:'tiny',sha256:'b'};
 const capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>({phase,artifactSha256:'b',contractSha256:workloadContract(workload),latencyStatus:'ok',timingSamples:5}))};
 assert.equal(reusableCapture(capture,workload,source,5,{groupSize:5}),false);
 for(const row of capture.results){row.sampling={method:'same-process-stability-v1',groupSize:5,maxSamples:35,warmup:0};row.samplesNs=[1,2,3,4,5];}
 assert.equal(reusableCapture(capture,workload,source,5,{groupSize:5}),true);
 capture.results[0].samplesNs.pop();
 assert.equal(reusableCapture(capture,workload,source,5,{groupSize:5}),false);
});

test('resume reuses new phase caps and legacy captures without remeasurement',()=>{
 const source={asOf:'2026-10-09',repository:'x/y',kind:'snapshot',revision:'a'},workload={sha256:'b'};
 for(const legacy of [false,true]){
  const capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>{
   const cap=legacy?35:['compile','instantiate'].includes(phase)?10:25;
   return {phase,artifactSha256:'b',contractSha256:workloadContract(workload),latencyStatus:'ok',timingSamples:cap,samplesNs:Array(cap).fill(1),sampling:{method:'same-process-stability-v1',groupSize:5,maxSamples:cap,warmup:0,stopReason:'sample-cap'}};
  })};
  assert.equal(reusableCapture(capture,workload,source,5,true),true);
  capture.results[0].sampling.maxSamples=25;
  assert.equal(reusableCapture(capture,workload,source,5,true),false);
 }
});

test('explicit historical reuse preserves old sample counts and policy without relabeling them',()=>{
 const source={asOf:'2026-10-04T10:00:00Z',repository:'x/y',kind:'snapshot',revision:'a'.repeat(40),ref:'main@aaaaaaaa'};
 const workload={id:'application',sha256:'b'.repeat(64)};
 const capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>({phase,version:source.revision,artifactSha256:workload.sha256,contractSha256:workloadContract(workload),latencyStatus:'ok',timingSamples:3,samplesNs:[10,20,30]}))};
 const before=structuredClone(capture);
 assert.equal(reusableCapture(capture,workload,source,5,{groupSize:5}),false);
 assert.equal(reusableCapture(capture,workload,source,5,{groupSize:5},true),true);
 assert.deepEqual(capture,before);
 for(const values of [[],[10,20],[10,20,NaN],[10,20,-1]]){
  const broken=structuredClone(capture);broken.results[0].samplesNs=values;
  assert.equal(reusableCapture(broken,workload,source,5,true,true),false);
 }
 const compatibility=structuredClone(capture);compatibility.results[0].sampling={method:'feature-compatibility-v1'};
 assert.equal(reusableCapture(compatibility,workload,source,5,true,true),false);
 const invalidAdaptive=structuredClone(capture);invalidAdaptive.results[0].sampling={method:'same-process-stability-v1',groupSize:5,maxSamples:25,warmup:0};
 assert.equal(reusableCapture(invalidAdaptive,workload,source,5,true,true),false);
 assert.equal(reusableCapture(capture,{...workload,sha256:'c'.repeat(64)},source,5,true,true),false);
 assert.equal(reusableCapture(capture,workload,{...source,revision:'c'.repeat(40)},5,true,true),false);
});
