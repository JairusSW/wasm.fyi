import test from 'node:test';
import assert from 'node:assert/strict';
import {latestRelease,releasedBuild} from './lib/release-policy.mjs';
import {goResults,countOutcomes} from './lib/conformance.mjs';
test('Wednesday source selection uses publication time, never main, drafts or nightlies',()=>{
  const r=(tag,date,extra={})=>({tag_name:tag,published_at:date,draft:false,prerelease:false,...extra});
  const rows=[r('nightly/2026-09-30','2026-09-30T00:00:00Z'),r('v2','2026-10-01T00:00:00Z'),r('v1','2026-09-29T00:00:00Z'),r('v3','2026-09-30T00:00:00Z',{draft:true})];
  assert.equal(latestRelease(rows,'2026-09-30T00:00:00Z').tag_name,'v1');
  assert.equal(latestRelease(rows).tag_name,'v2');
  assert.equal(latestRelease([r('v1','2026-09-30T00:00:00Z')],'2026-09-30T00:00:00.000Z').tag_name,'v1');
  assert.equal(releasedBuild(r('main','2026-09-29T00:00:00Z')),false);
  assert.equal(releasedBuild(r('v0.1-beta.11','2026-09-29T00:00:00Z',{prerelease:true})),true);
  assert.equal(releasedBuild(r('main',null)),false);
});
test('upstream Go runners count leaf tests, retain skips, and expose zero-test invocations',()=>{
  const log=[{Action:'run',Test:'Suite'},{Action:'run',Test:'Suite/A'},{Action:'pass',Test:'Suite/A'},{Action:'skip',Test:'Suite/B'},{Action:'pass',Test:'Suite'}].map(x=>JSON.stringify(x)).join('\n');
  const r=goResults(log);assert.equal(r.results.length,2);assert.equal(r.totals.passed,1);assert.equal(r.totals.skipped,1);
  assert.equal(goResults('{}').testsStarted,0);
  assert.equal(countOutcomes([{status:'runner-error'},{status:'failed'}]).passed,0);
});
