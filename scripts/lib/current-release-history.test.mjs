import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindCurrentReleaseHistory} from './current-release-history.mjs';
const revision='a'.repeat(40),hash='b'.repeat(64);
function fixture(){
 const archived={st:'ok',v:2,report:'archived',role:'retrospective-revision'};
 const current={st:'failed',report:'current'};
 const output={configurations:{G:'wago'},catalogue:[{id:'workload',artifactSha256:hash}],hosts:{m2:{snapshots:{s1:{'workload|G|steady':current}}}},history:{m2:{points:[{revision},{revision:'older'}],artifactSha256:{workload:hash},cells:{'workload|G|steady':[archived,{...archived}]}}}};
 const reports=[{id:'current',runtimes:[{id:'wago',description:{runtime_version:revision+'/source-digest'}}],workloads:[{id:'workload',sha256:hash}]}];
 return {output,reports};
}
test('aliases the verified release capture, preserves failures and leaves older dates untouched',()=>{
 const {output,reports}=fixture(),older=structuredClone(output.history.m2.cells['workload|G|steady'][1]);
 bindCurrentReleaseHistory(output,reports,{revision},{steady:'steady'});
 assert.deepEqual(output.history.m2.cells['workload|G|steady'][0],{st:'failed',report:'current',role:'retrospective-revision'});
 assert.deepEqual(output.history.m2.cells['workload|G|steady'][1],older);
 assert.equal(output.history.m2.points[0].currentLatency.G,'s1');
});
for(const mismatch of ['revision','artifact','missing report'])test(`refuses a release alias with mismatched ${mismatch}`,()=>{
 const {output,reports}=fixture(),before=structuredClone(output.history);
 if(mismatch==='revision')reports[0].runtimes[0].description.runtime_version='v0.1.0-beta.11';
 if(mismatch==='artifact')reports[0].workloads[0].sha256='changed';
 if(mismatch==='missing report')reports.length=0;
 bindCurrentReleaseHistory(output,reports,{revision},{steady:'steady'});
 assert.deepEqual(output.history,before);
});
