import {test} from 'node:test';import assert from 'node:assert/strict';import {nearestCommit,nearestCommitSearchUntil,everyVersion,reusableCapture} from './lib/history-scope.mjs';
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
test('never reuses a three-sample or partial run for the five-sample request',()=>{const source={asOf:'2026-01-01',repository:'x/y',kind:'snapshot',revision:'a'},workload={sha256:'b'},capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>({phase,artifactSha256:'b',latencyStatus:'ok',timingSamples:3}))};assert.equal(reusableCapture(capture,workload,source,5),false);for(const r of capture.results)r.timingSamples=5;assert.equal(reusableCapture(capture,workload,source,5),true);capture.results.pop();assert.equal(reusableCapture(capture,workload,source,5),false)});

test('twelve-sample jobs refuse previous five-sample captures',()=>{const source={asOf:'2026-01-01',repository:'x/y',kind:'snapshot',revision:'a'},workload={sha256:'b'},capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>({phase,artifactSha256:'b',latencyStatus:'ok',timingSamples:5}))};assert.equal(reusableCapture(capture,workload,source,12),false);for(const r of capture.results)r.timingSamples=12;assert.equal(reusableCapture(capture,workload,source,12),true)});
test('versions sharing a commit and timestamp retain distinct source identities',()=>{
 const source={asOf:'2026-01-01',repository:'x/y',kind:'release',revision:'a',ref:'v1-beta.1',dateBasis:'go-module-commit'},workload={sha256:'b'};
 const capture={source,results:['compile','instantiate','first-call','steady'].map(phase=>({phase,artifactSha256:'b',latencyStatus:'ok',timingSamples:12}))};
 assert.equal(reusableCapture(capture,workload,source,12),true);
 assert.equal(reusableCapture(capture,workload,{...source,ref:'v1-canary'},12),false);
 assert.equal(reusableCapture(capture,workload,{...source,dateBasis:undefined},12),false);
});
