import test from 'node:test';
import assert from 'node:assert/strict';
import {latestRelease,latestBetaRelease,releasedBuild,parseReleasePages} from './lib/release-policy.mjs';
import {goResults,countOutcomes,wasiCaseTotals} from './lib/conformance.mjs';
test('Saturday source selection uses publication time, never main, drafts or nightlies',()=>{
  const r=(tag,date,extra={})=>({tag_name:tag,published_at:date,draft:false,prerelease:false,...extra});
  const rows=[r('nightly/2026-09-30','2026-09-30T00:00:00Z'),r('v2','2026-10-01T00:00:00Z'),r('v1','2026-09-29T00:00:00Z'),r('v3','2026-09-30T00:00:00Z',{draft:true})];
  assert.equal(latestRelease(rows,'2026-09-30T00:00:00Z').tag_name,'v1');
  assert.equal(latestRelease(rows).tag_name,'v2');
  assert.equal(latestRelease([r('v1','2026-09-30T00:00:00Z')],'2026-09-30T00:00:00.000Z').tag_name,'v1');
  assert.equal(releasedBuild(r('main','2026-09-29T00:00:00Z')),false);
  assert.equal(releasedBuild(r('v0.1-beta.11','2026-09-29T00:00:00Z',{prerelease:true})),true);
  assert.equal(latestRelease([r('v0.2-beta.1','2026-10-02T00:00:00Z',{prerelease:true}),r('v0.1.9','2026-09-29T00:00:00Z')]).tag_name,'v0.1.9');
  assert.equal(latestBetaRelease([r('v0.2-beta.1','2026-10-02T00:00:00Z',{prerelease:true}),r('v0.1-beta.9','2026-09-30T00:00:00Z',{prerelease:true})],'2026-10-01T00:00:00Z').tag_name,'v0.1-beta.9');
  assert.equal(latestBetaRelease([r('v0.2-beta.1','2026-10-02T00:00:00Z',{prerelease:true})],'2026-10-01T00:00:00Z'),null);
  assert.equal(releasedBuild(r('main',null)),false);
});
test('upstream Go runners count leaf tests, retain skips, and expose zero-test invocations',()=>{
  const log=[{Action:'run',Test:'Suite'},{Action:'run',Test:'Suite/A'},{Action:'pass',Test:'Suite/A'},{Action:'skip',Test:'Suite/B'},{Action:'pass',Test:'Suite'}].map(x=>JSON.stringify({Package:'fixture/suite',...x})).join('\n');
  const r=goResults(log);assert.equal(r.results.length,2);assert.equal(r.totals.passed,1);assert.equal(r.totals.skipped,1);
  assert.equal(goResults('{}').testsStarted,0);
  assert.equal(goResults(JSON.stringify({Action:'pass',Test:'Suite/A'})).results.length,0,'Unqualified Go events cannot establish suite success');
  const repeated=goResults(['fixture/one','fixture/two'].map(Package=>JSON.stringify({Package,Action:'pass',Test:'Suite/A'})).join('\n'));
  assert.equal(repeated.totals.passed,2,'Identical test names in separate packages remain independent cases');
  assert.equal(countOutcomes([{status:'runner-error'},{status:'failed'}]).passed,0);
});

test('WASI case totals are separate from the single Go suite test',()=>{
  assert.deepEqual(wasiCaseTotals('TOTAL[wasip1]: passed=70 failed=2 skipped=0 (of 72)'),{passed:70,failed:2,unsupported:0,skipped:0,'runner-error':0,crashed:0});
  assert.equal(wasiCaseTotals('TOTAL[wasip1]: passed=70 failed=2 skipped=0 (of 73)'),null);
  assert.equal(wasiCaseTotals('no suite ran'),null);
  assert.equal(wasiCaseTotals('TOTAL[wasip1]: passed=0 failed=0 skipped=0 (of 0)'),null);
});

test('release pagination works with older GitHub CLI without slurp',()=>{
  assert.deepEqual(parseReleasePages('[{"tag_name":"v2"}]\n[{"tag_name":"v1"}]\n'),[{tag_name:'v2'},{tag_name:'v1'}]);
  assert.deepEqual(parseReleasePages(''),[]);
  assert.throws(()=>parseReleasePages('not json'));
});
