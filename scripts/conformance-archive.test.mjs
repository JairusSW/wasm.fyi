import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyConformanceArchive,conformanceSummary} from './lib/conformance-archive.mjs';
import {goResults,countOutcomes} from './lib/conformance.mjs';
import {digest} from './lib/wasmbench.mjs';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCommand} from './lib/benchmark-process.mjs';
const host={hostname:'fixture',os:'darwin',arch:'arm64'};
function fixture(){const results=['passed','failed','unsupported','skipped','runner-error','crashed'].map((status,i)=>({path:i+'.wast',sha256:digest(String(i)),status}));return {schema:1,host,created:'2026-10-06T21:00:00Z',coverage:[{engine:'wasmtime',status:'selected'},{engine:'wago',status:'uncollected',reason:'No completed official runner capture.'}],lanes:[{id:'wasmtime-core',kind:'wast',unit:'files',engine:{tag:'v40.0.0',sha256:digest('binary')},suite:{repository:'WebAssembly/spec',revision:'a'.repeat(40),inventory:results.map(({path,sha256})=>({path,sha256}))},results,totals:countOutcomes(results)},{id:'unavailable-runner',status:'runner-error',reason:'Fixture unavailable'}]};}
function verify(report){const bytes=Buffer.from(JSON.stringify(report));return verifyConformanceArchive(bytes,Buffer.from(digest(bytes)+'\n'));}
test('conformance archive preserves failed, skipped and uncollected source evidence and distinct units',()=>{
  const report=fixture(),verified=verify(report),summary=conformanceSummary(verified.report,verified.sha256);
  assert.equal(summary.lanes[0].unit,'files');assert.equal(summary.lanes[0].status,'failed');assert.deepEqual(summary.lanes[0].totals,report.lanes[0].totals);assert.equal(summary.lanes[1].status,'runner-error');assert.equal(summary.lanes[1].totals,undefined);assert.equal(verified.report.coverage[1].status,'uncollected');
  const bytes=Buffer.from(JSON.stringify(report));assert.throws(()=>verifyConformanceArchive(bytes,Buffer.from('0'.repeat(64))),/Changed conformance archive/);
});
test('conformance archives reject missing or invented WAST outcomes before publication',()=>{
  for(const [label,mutate]of Object.entries({
    duplicate:r=>{r.lanes[0].results[1]=r.lanes[0].results[0]},
    missing:r=>{r.lanes[0].results.pop()},
    drift:r=>{r.lanes[0].totals.passed++},
    unknown:r=>{r.lanes[0].results[0].status='not-a-pass'},
    empty:r=>{r.lanes[0].results=[];r.lanes[0].suite.inventory=[];r.lanes[0].totals=countOutcomes([])},
    escaping:r=>{r.lanes[0].suite.inventory[0].path='../outside.wast'},
    date:r=>{r.created='2026-02-30T00:00:00Z'},
    duplicateLane:r=>{r.lanes.push(r.lanes[0])},
    wrongUnit:r=>{r.lanes[0].unit='assertions'},
    fabricatedCoverage:r=>{r.coverage[1].status='passed'},
  })){const report=fixture();mutate(report);assert.throws(()=>verify(report),undefined,label)}
});
test('Go conformance leaves retain package identity instead of merging equal test names',()=>{
  const events=[
    {Package:'p1',Test:'TestSame',Action:'run'},
    {Package:'p1',Test:'TestSame/child',Action:'run'},
    {Package:'p1',Test:'TestSame/child',Action:'fail'},
    {Package:'p1',Test:'TestSame',Action:'fail'},
    {Package:'p2',Test:'TestSame',Action:'run'},
    {Package:'p2',Test:'TestSame',Action:'pass'},
    {Test:'TestForged',Action:'run'},{Test:'TestForged',Action:'pass'},
  ];
  const parsed=goResults(events.map(JSON.stringify).join('\n'));
  assert.equal(parsed.parserVersion,'package-qualified-go-leaves-v2');assert.equal(parsed.testsStarted,3);assert.equal(parsed.results.length,2);assert.equal(parsed.totals.failed,1);assert.equal(parsed.totals.passed,1);assert.deepEqual(parsed.results.map(r=>[r.package,r.name]),[['p1','TestSame/child'],['p2','TestSame']]);
  const report=fixture();report.lanes=[{id:'plugin-library',kind:'go-native-suite',unit:'leaf subtests',status:'failed',...parsed}];assert.doesNotThrow(()=>verify(report));
});
test('official WASI case totals remain separate from Go leaf counts and expected failures',()=>{
  const report=fixture();report.lanes=[{id:'wago-wasi',kind:'go-native-suite',unit:'official Preview 1 cases',status:'failed',output:'TOTAL[wasip1]: passed=10 failed=2 skipped=3 (of 15)',totals:{passed:10,failed:2,skipped:3},results:[{name:'TestWASISuite',status:'failed'}]}];assert.doesNotThrow(()=>verify(report));report.lanes[0].totals.failed=1;assert.throws(()=>verify(report),/totals differ/);
  report.lanes=[{id:'wasmtime-wasi',kind:'official-wasi-runner',unit:'cases',status:'passed',results:[{status:'skipped',outcome:'xfail'},{status:'failed',outcome:'xpass'}],totals:{skipped:1,failed:1}}];const {report:checked}=verify(report);assert.equal(checked.lanes[0].results[0].outcome,'xfail');assert.equal(checked.lanes[0].results[1].outcome,'xpass');
});

test('existing conformance publisher preserves immutable evidence and stops on retained-index damage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'conformance-publish-'));
  try{
    const isolated=join(root,'site');await mkdir(isolated);await cp(fileURLToPath(new URL('./',import.meta.url)),join(isolated,'scripts'),{recursive:true});
    const source=join(root,'capture');await mkdir(source);const bytes=Buffer.from(JSON.stringify(fixture())),sha=digest(bytes);await writeFile(join(source,'report.json'),bytes);await writeFile(join(source,'sha256'),sha+'\n');
    const publish=()=>runCommand(process.execPath,[join(isolated,'scripts/publish-conformance.mjs'),source],{cwd:isolated});
    await publish();const path=join(isolated,'data/conformance/index.json'),staticPath=join(isolated,'static/wasmbench/conformance/index.json'),first=await readFile(path);
    assert((await readFile(staticPath)).equals(first));assert((await readFile(join(isolated,'static/wasmbench/conformance',sha+'.json'))).equals(bytes));await publish();assert((await readFile(path)).equals(first));
    await writeFile(path,'{invalid index');await assert.rejects(publish());assert.equal(await readFile(path,'utf8'),'{invalid index');assert((await readFile(staticPath)).equals(first));
    await writeFile(path,first);await writeFile(join(isolated,'static/wasmbench/conformance',sha+'.json'),'corrupted prior artifact');await assert.rejects(publish(),/Changed published conformance object/);assert((await readFile(staticPath)).equals(first));
  }finally{await rm(root,{recursive:true,force:true})}
});
