import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindCapturedReleases} from './captured-release-history.mjs';
const release={runtime:'wasmtime',version:'46.0.1',publishedAt:'2026-06-24T18:51:42Z',url:'https://example.test/release'};
function fixture(){
 const output={configurations:{A:'wasmtime'},catalogue:[{id:'app',artifactSha256:'hash'}],hosts:{m2:{snapshots:{s1:{'app|A|steady':{st:'failed',report:'r'}}}}},history:{m2:{points:[{date:'2026-07-04',revision:'commit',status:'measured'}],cells:{'app|A|steady':[{st:'ok',v:2,report:'old'}]},versions:{A:['commit']},artifactSha256:{app:'hash'}}}};
 const reports=[{id:'r',created:'2026-10-05T00:00:00Z',runtimes:[{id:'wasmtime',description:{runtime_version:'46.0.1'}}],workloads:[{id:'app',sha256:'hash'}]}];return {output,reports};
}
test('adds one dated release from captured evidence while preserving failures and weekly cells',()=>{
 const {output,reports}=fixture(),weekly=structuredClone(output.history.m2.cells['app|A|steady'][0]);
 bindCapturedReleases(output,reports,[release],['steady']);bindCapturedReleases(output,reports,[release],['steady']);
 const h=output.history.m2;assert.equal(h.points.length,2);assert.equal(h.points[1].date,'2026-06-24');
 assert.equal(h.versions.A[1],'46.0.1');assert.equal(h.points[1].currentLatency.A,'s1');
 assert.deepEqual(h.cells['app|A|steady'][0],weekly);assert.equal(h.cells['app|A|steady'][1].st,'failed');
});
for(const mismatch of ['version','artifact','missing report'])test(`rejects release evidence with mismatched ${mismatch}`,()=>{
 const {output,reports}=fixture(),before=structuredClone(output.history);
 if(mismatch==='version')reports[0].runtimes[0].description.runtime_version='other';
 if(mismatch==='artifact')reports[0].workloads[0].sha256='other';
 if(mismatch==='missing report')reports.length=0;
 bindCapturedReleases(output,reports,[release],['steady']);assert.deepEqual(output.history,before);
});
test('omits stale auxiliary observations without losing the matching release timing',()=>{
 const {output,reports}=fixture();
 output.hosts.m2.snapshots.s1['app|A|rssCurrent']={st:'ok',v:123,report:'old'};
 reports.push({...reports[0],id:'old',runtimes:[{id:'wasmtime',description:{runtime_version:'old'}}]});
 bindCapturedReleases(output,reports,[release],['steady','rssCurrent']);
 assert.equal(output.history.m2.points[1].releases.A.version,'46.0.1');
 assert.equal(output.history.m2.cells['app|A|rssCurrent'],undefined);
});
