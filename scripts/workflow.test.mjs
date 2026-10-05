import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm, mkdir, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, compact, digest, installDirectory } from './lib/wasmbench.mjs';
import { packEvidence, fileDigest } from './lib/evidence-archive.mjs';
import { validateWasmFyiReceipt } from './lib/wasmfyi-export.mjs';
import { writeIndex, datasetFiles } from './lib/snapshot-index.mjs';
import { validateReport, validateData } from './lib/validate-data.mjs';
import { threadEvidencePath, validateThreadEvidence, stageAuxiliary } from './lib/auxiliary-data.mjs';

test('stages dual-tier worker evidence while rejecting unsafe paths and incomplete cohorts',()=>{
  for(const name of ['darwin-arm64.json','linux-x64-liftoff-only.json','darwin-arm64-optimizing-only.json','a'.repeat(64)+'.json'])assert(threadEvidencePath(name));
  for(const name of ['../linux-x64.json','linux-x64-unknown.json','sub/linux-x64.json','linux-x64.json/extra'])assert(!threadEvidencePath(name));
  const cases=mode=>Array.from({length:32},()=>({compilerMode:mode,launches:Array.from({length:3},()=>({samples:Array.from({length:3},()=>({verified:true,elapsedNs:1}))}))}));
  validateThreadEvidence({schema:1,feature:'threads',results:cases('optimizing-only')});
  const data={schema:2,feature:'threads',variants:{'optimizing-only':{},'liftoff-only':{}},results:[...cases('optimizing-only'),...cases('liftoff-only')]};
  validateThreadEvidence(data);
  assert.throws(()=>validateThreadEvidence({...data,results:data.results.slice(1)}));
  assert.throws(()=>validateThreadEvidence({...data,results:[...cases('optimizing-only'),...cases('optimizing-only')]}));
});

function report() {
  return { id: 'a'.repeat(64), lockSha256: 'b'.repeat(64), runId: 'fixture', created: '2026-10-01T00:00:00Z',
    publication: 'local_exploratory', options: { profile: 'timing' }, host: { os: 'linux', arch: 'arm64' },
    runtimes: [{ id: 'engine/backend' }], workloads: [{ id: 'core/add', sha256: 'c'.repeat(64) }],
    summaries: [{ runtime: 'engine/backend', workload: 'core/add', scenario: 'compile', profile: 'timing',
      median_ns_per_operation: 0, ci95_low: null, ci95_high: null, independent_launches: 1,
      latency_status: 'timing_pass', outcomes: { ok: 1, unsupported: 1 } }],
    memory: [], memorySource: null, codeRecords: [], evidence: 'a'.repeat(64) + '.json', trials: [] };
}

test('retains true zero, missing intervals and partial failure outcomes', () => validateReport(report()));
test('external projections retain evidence and reject changed summaries or index metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wasm-fyi-index-'));
  try {
    const value = report(), bytes = JSON.stringify(value);
    await writeFile(join(directory, value.evidence), bytes);
    const projected = { ...compact(value), evidenceSha256: digest(bytes) };
    await writeIndex(directory, [projected]);
    const sharedIndex = JSON.parse(await readFile(join(directory, 'index.json')));
    assert.equal(Object.keys(sharedIndex.hosts).length,1);
    assert.deepEqual(sharedIndex.reports[0].host,JSON.parse(JSON.stringify({os:projected.host.os,arch:projected.host.arch,hostname:projected.host.hostname})));
    sharedIndex.hosts[sharedIndex.reports[0].hostSha256].os='tampered';
    await writeFile(join(directory,'index.json'),JSON.stringify(sharedIndex));
    await assert.rejects(validateData(directory),/Host digest mismatch/);
    await writeIndex(directory,[projected]);
    const validated = await validateData(directory);
    assert.deepEqual(validated.reports, [projected]);
    assert.equal(datasetFiles(validated).length, 3);
    const index = JSON.parse(await readFile(join(directory, 'index.json')));
    index.reports[0].runId = 'wrong-run';
    await writeFile(join(directory, 'index.json'), JSON.stringify(index));
    await assert.rejects(validateData(directory), /Projection metadata mismatch/);
    await writeIndex(directory, [projected]);
    await writeFile(join(directory, value.id + '.summary.json'), '{}');
    await assert.rejects(validateData(directory), /Projection digest mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('evidence transport preserves duplicate bytes and source files and retains failed passes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wasm-fyi-transport-'));
  try {
    const source = join(directory, 'source'), output = join(directory, 'output');
    await mkdir(join(source, 'experiments/run/report/raw'), { recursive: true });
    await mkdir(join(source, 'experiments/run/timing-run'), { recursive: true });
    await mkdir(output);
    const paths = ['experiments/run/report/data.json', 'experiments/run/report/raw/duplicate.json'];
    for (const path of paths) await writeFile(join(source, path), 'same sealed bytes');
    await writeFile(join(source, 'experiments/run/timing-run/partial.json'), 'partial evidence');
    const archive = join(directory, 'evidence.tar.xz');
    const metadata = await packEvidence(source, archive, true);
    assert.equal(metadata.files, 2); assert.equal(metadata.uniqueFiles, 1);
    assert.equal(metadata.sha256, await fileDigest(archive));
    command('tar', ['-xJf', archive, '-C', output]);
    for (const path of paths) assert.equal(await readFile(join(output, path), 'utf8'), 'same sealed bytes');
    assert.equal((await stat(join(output, paths[0]))).ino, (await stat(join(output, paths[1]))).ino);
    await writeFile(join(output, paths[0]), 'changed owned copy');
    assert.equal(await readFile(join(source, paths[0]), 'utf8'), 'same sealed bytes');
    assert.equal((await packEvidence(source, archive, false)).files, 3);
    await symlink(join(source, paths[0]), join(source, 'unsafe-link'));
    await assert.rejects(packEvidence(source, archive), /regular files only/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('complete Hub transport can include only the latest sealed report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wasm-fyi-latest-report-'));
  try {
    const source = join(directory, 'source'), output = join(directory, 'output');
    const report = join(source, 'experiments', 'run-123', 'report');
    await mkdir(join(report, 'raw'), { recursive: true });
    await mkdir(join(source, 'experiments', 'old-run', 'report'), { recursive: true });
    await writeFile(join(source, 'latest-report.txt'), `${report}\n`);
    await writeFile(join(report, 'checksums.json'), '{}');
    await writeFile(join(report, 'raw', 'manifest.json'), '{}');
    await writeFile(join(source, 'experiments', 'old-run', 'report', 'checksums.json'), 'old');
    await writeFile(join(source, 'upstream-cache.json'), 'not needed after sealing');
    await mkdir(output);
    const archive = join(directory, 'latest.tar.xz');
    const metadata = await packEvidence(source, archive, true, true);
    assert.equal(metadata.files, 3);
    command('tar', ['-xJf', archive, '-C', output]);
    assert.equal(await readFile(join(output, 'latest-report.txt'), 'utf8'), `${report}\n`);
    assert.equal(await readFile(join(output, 'experiments/run-123/report/raw/manifest.json'), 'utf8'), '{}');
    await assert.rejects(readFile(join(output, 'experiments/old-run/report/checksums.json')));
    await assert.rejects(readFile(join(output, 'upstream-cache.json')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('wasm.fyi transport exports only the verified website projection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wasm-fyi-projection-'));
  try {
    const source = join(directory, 'source');
    const report = join(source, 'experiments', 'run-123', 'report');
    const output = join(directory, 'output');
    await mkdir(report, { recursive: true }); await mkdir(output);
    const data = {
      schema: 1, analysis_version: 'fixture', unused_large_field: 'drop me',
      bundle: { manifest: { id: 'run-123', kind: 'measurement', lock: { options: { profile: 'timing' } } },
        artifact_admission: [], trials: [{ id: 't1', samples: [] }] },
      summaries: [], metrics: [], scenarios: [], throughput: [], code_records: [], code_source: null
    };
    const dataBytes = Buffer.from(JSON.stringify(data) + '\n');
    await writeFile(join(report, 'data.json'), dataBytes);
    await writeFile(join(report, 'checksums.json'), JSON.stringify({ 'data.json': digest(dataBytes) }));
    await writeFile(join(source, 'latest-report.txt'), report + '\n');
    const archive = join(directory, 'evidence.tar.zst');
    const metadata = await packEvidence(source, archive, true, true, true);
    assert.equal(metadata.profile, 'wasm.fyi-v1');
    assert.equal(metadata.sha256, await fileDigest(archive));
    command(process.platform==='darwin'?'gtar':'tar', ['-I', 'zstd', '-xf', archive, '-C', output]);
    const relative = (await readFile(join(output, 'latest-wasm-fyi-report.txt'), 'utf8')).trim();
    const exported = join(output, relative);
    const projection = JSON.parse(await readFile(join(exported, 'data.json'), 'utf8'));
    assert.equal(projection.unused_large_field, undefined);
    assert.equal(projection.bundle.trials[0].id, 't1');
    assert.equal(projection.bundle.manifest.id, 'run-123');
    const receipt = validateWasmFyiReceipt(JSON.parse(await readFile(join(exported, 'wasm-fyi-export.json'), 'utf8')));
    assert.equal(receipt.runId, 'run-123');
    assert.equal(receipt.sourceReportSha256, digest(dataBytes));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('rejects diagnostic timing masquerading as latency', () => {
  const value = report(); value.summaries[0].latency_status = 'not_timing_pass';
  assert.throws(() => validateReport(value), /Diagnostic latency/);
});
test('rejects invented one-launch confidence intervals', () => {
  const value = report(); value.summaries[0].ci95_low = 0; value.summaries[0].ci95_high = 1;
  assert.throws(() => validateReport(value), /Unsupported confidence interval/);
});
test('rejects values outside the exact locked configuration/workload cohort', () => {
  const value = report(); value.summaries[0].runtime = 'other-backend';
  assert.throws(() => validateReport(value), /outside the locked cohort/);
});
test('rejects memory values without paired-pass provenance', () => {
  const value = report(); value.memory = [{ runtime: 'engine/backend', workload: 'core/add', median_bytes: 100 }];
  assert.throws(() => validateReport(value), /matched-pass provenance/);
});
test('same-trial RSS requires its locked timing run and source profile',()=>{
 const value=report();value.options.timing_peak_rss=true;value.memorySource={id:value.runId,profile:'timing'};
 value.memory=[{runtime:'engine/backend',workload:'core/add',metric:'process.peak_rss',source_profile:'timing',source_run:value.runId,median_bytes:100,ci95_low_bytes:null,ci95_high_bytes:null}];
 validateReport(value);
 for(const change of [v=>v.options.timing_peak_rss=false,v=>v.memory[0].source_run='other',v=>v.memory[0].metric='host.alloc.bytes',v=>v.memorySource.profile='memory']) {
  const altered=structuredClone(value);change(altered);assert.throws(()=>validateReport(altered));
 }
});
test('snapshot IDs preserve original timing memory provenance and reject tampering', () => {
  const value=report();
  value.sourceRunId=value.runId;
  value.runId=`${value.sourceRunId}-${digest(JSON.stringify([value.host.hostname,value.host.os,value.host.arch,value.created,value.lockSha256])).slice(0,16)}`;
  value.options.timing_peak_rss=true;
  value.memorySource={id:'memory',profile:'memory',timing_id:value.sourceRunId};
  value.memory=[{runtime:'engine/backend',workload:'core/add',metric:'process.peak_rss',source_profile:'timing',source_run:value.sourceRunId,median_bytes:100,ci95_low_bytes:null,ci95_high_bytes:null}];
  validateReport(value);
  for(const change of [v=>v.created='2026-10-02T00:00:00Z',v=>v.memory[0].source_run='other',v=>v.memorySource.timing_id='other']){
    const altered=structuredClone(value);change(altered);assert.throws(()=>validateReport(altered));
  }
});
test('checks evidence digests and rejects unsafe paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wasm-fyi-validation-'));
  try {
    const value = report(); const bytes = JSON.stringify(value);
    const indexed = { ...compact(value), evidenceSha256: digest(bytes) };
    await writeFile(join(directory, value.evidence), bytes);
    await writeFile(join(directory, 'index.json'), JSON.stringify({ schema: 1, reports: [indexed] }));
    await validateData(directory);
    await writeFile(join(directory, value.evidence), bytes + ' ');
    await assert.rejects(validateData(directory), /Evidence digest mismatch/);
    indexed.evidence = '../outside.json';
    await writeFile(join(directory, 'index.json'), JSON.stringify({ schema: 1, reports: [indexed] }));
    await assert.rejects(validateData(directory), /Unsafe evidence path/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('directory installation failure restores the previous dataset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wasm-fyi-rollback-'));
  try {
    const destination = join(directory, 'current');
    await mkdir(destination); await writeFile(join(destination, 'index.json'), 'previous');
    await assert.rejects(installDirectory(join(directory, 'missing'), destination));
    assert.equal(await readFile(join(destination, 'index.json'), 'utf8'), 'previous');
    const staged = join(directory, 'staged'); await mkdir(staged); await writeFile(join(staged, 'index.json'), 'next');
    const undo = await installDirectory(staged, destination);
    assert.equal(await readFile(join(destination, 'index.json'), 'utf8'), 'next');
    await undo(true);
    assert.equal(await readFile(join(destination, 'index.json'), 'utf8'), 'previous');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('static evidence rollback backups stay outside the public directory',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'wasm-fyi-private-backup-'));
  try {
    const publicDirectory=join(directory,'public'),destination=join(publicDirectory,'wasmbench'),backup=join(directory,'private-backup'),staged=join(directory,'next');
    await mkdir(destination,{recursive:true});await writeFile(join(destination,'index.json'),'previous');
    await mkdir(staged);await writeFile(join(staged,'index.json'),'next');
    const undo=await installDirectory(staged,destination,backup);
    assert.deepEqual(await readdir(publicDirectory),['wasmbench']);
    assert.equal(await readFile(join(backup,'index.json'),'utf8'),'previous');
    await undo(true);
    assert.equal(await readFile(join(destination,'index.json'),'utf8'),'previous');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('original report seal rejects corrupted and unsealed files before rebuilding', async () => {
  const { verifySeal } = await import('./lib/verify-seal.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'wasm-fyi-seal-'));
  try {
    const bytes = '{"raw":"immutable"}\n';
    await writeFile(join(directory, 'data.json'), bytes);
    await writeFile(join(directory, 'checksums.json'), JSON.stringify({ 'data.json': digest(bytes) }));
    await verifySeal(directory);
    await writeFile(join(directory, 'data.json'), bytes + ' ');
    await assert.rejects(verifySeal(directory), /checksum mismatch/);
    await writeFile(join(directory, 'data.json'), bytes);
    await writeFile(join(directory, 'unexpected.json'), '{}');
    await assert.rejects(verifySeal(directory), /exact archive/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('feature support excludes scalar baselines and distinguishes failures and compile-only evidence', async () => {
  const { featureSupport } = await import('./lib/feature-support.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'wasm-fyi-feature-support-'));
  try {
    const workloads = [
      {id:'features/gc/allocation/64',sha256:'a'.repeat(64),provenance:{scope:'execution'}},
      {id:'features/gc/access-scalar-baseline/64',sha256:'b'.repeat(64),provenance:{baseline:true}},
      {id:'features/cm-async/future/1',sha256:'c'.repeat(64),provenance:{scope:'compile-only'}}
    ];
    const trials = [
      {workload:workloads[0].id,runtime_configuration:'r',scenario:'compile',status:'ok'},
      {workload:workloads[0].id,runtime_configuration:'r',scenario:'first-call',status:'preflight_failed',reason:'incorrect oracle'},
      {workload:workloads[1].id,runtime_configuration:'r',scenario:'first-call',status:'ok'},
      {workload:workloads[2].id,runtime_configuration:'r',scenario:'compile',status:'ok'}
    ];
    await writeFile(join(directory,'raw.json'),JSON.stringify({trials}));
    const matrix=await featureSupport(directory,[{id:'e',created:'2026-10-01',host:{hostname:'test',os:'test',arch:'test'},runtimes:[{id:'r'}],workloads,evidence:'raw.json',evidenceSha256:'d'}]);
    const features=matrix.hosts[0].configurations[0].features;
    const gc=features.find(f=>f.id==='gc');assert.equal(gc.cases.length,1);assert.equal(gc.executed,0);assert.equal(gc.failed,1);
    assert.deepEqual(gc.cases[0].reasons,['incorrect oracle']);
    assert.equal(features.find(f=>f.id==='cm-async').compiledOnly,1);
    assert.equal(features.find(f=>f.id==='simd').coverage,'not-tested');
    await writeFile(join(directory,'packed-trials.json'),JSON.stringify({schema:'interned-columns-v1',trialColumns:['id','runtime_configuration','workload','scenario','profile','block','status','reason','started','duration_ns','samples','log','isolation'],sampleColumns:['index','warmup','elapsed_ns','operations','sample_type','verified','result'],strings:['r',workloads[0].id,'first-call','timing','preflight_failed','packed diagnostic','individual_operation','logs/t1.log','{"mode":"uncontrolled"}'],trials:[
      ['t1',0,1,2,3,0,4,5,'2026-10-01T00:00:00Z',4,[[0,false,123,1,6,true,{value:9}]],7,8]
    ]}));
    await writeFile(join(directory,'packed.json'),JSON.stringify({trialsEvidence:'packed-trials.json'}));
    const packed=await featureSupport(directory,[{id:'p',created:'2026-10-02',host:{hostname:'packed',os:'test',arch:'test'},runtimes:[{id:'r'}],workloads,evidence:'packed.json',evidenceSha256:'e'}]);
    assert.deepEqual(packed.hosts[0].configurations[0].features.find(f=>f.id==='gc').cases[0].reasons,['packed diagnostic']);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('a failed launch withholds headline timing even when other launches succeeded',async()=>{
  const {withholdFailedCells}=await import('./lib/measurement-policy.mjs');
  const value={median_ns_per_operation:123,ci95_low:100,ci95_high:150,outcomes:{ok:2,error:1},latency_status:'timing_pass'};
  const [projected]=withholdFailedCells([value]);
  assert.equal(projected.median_ns_per_operation,null);assert.equal(projected.ci95_low,null);assert.equal(projected.ci95_high,null);
  assert.equal(projected.latency_status,'failed_cell');assert.equal(value.median_ns_per_operation,123);
  assert.deepEqual(withholdFailedCells([{...value,outcomes:{ok:3}}]),[{...value,outcomes:{ok:3}}]);
});

test('history baseline refresh preserves retrospective evidence and rejects changed hosts or artifacts',async()=>{
  const {stageHistoryBaseline}=await import('./lib/history-baseline.mjs');
  const temporary=await mkdtemp(join(tmpdir(),'wasm-fyi-baseline-'));
  try {
    const source=join(temporary,'history'),current=join(temporary,'current'),staged=join(temporary,'staged');
    await mkdir(source);await mkdir(current);
    const make=async(directory,value)=>{
      value.evidence=value.id+'.json';
      const bytes=JSON.stringify(value);
      await writeFile(join(directory,value.evidence),bytes);
      return {...compact(value),evidenceSha256:digest(bytes)};
    };
    const old={...report(),id:'1'.repeat(64),runId:'old-baseline',created:'2026-09-30T00:00:00Z'};
    const historical={...report(),id:'2'.repeat(64),runId:'historical-wago',created:'2026-10-01T01:00:00Z'};
    const oldProjected=await make(source,old),pastProjected=await make(source,historical);
    await writeIndex(source,[pastProjected,oldProjected]);
    const results=[{targetWeek:'2026-08-06',runId:historical.runId,collectedAt:historical.created,revision:'3'.repeat(40)}];
    await writeFile(join(source,'weekly.json'),JSON.stringify({baseline:{report:old.id},results}));
    const next={...report(),id:'4'.repeat(64),runId:'new-baseline',created:'2026-10-01T02:00:00Z'};
    const nextProjected=await make(current,next);
    const changedHost={...nextProjected,host:{...nextProjected.host,os:'other'}};
    const changedArtifact={...nextProjected,workloads:[{...nextProjected.workloads[0],sha256:'5'.repeat(64)}]};
    assert.equal(await stageHistoryBaseline(source,current,[changedHost,changedArtifact],staged,['engine/backend']),false);
    assert.equal(await stageHistoryBaseline(source,current,[nextProjected],staged,['uncollected/backend']),false);
    assert.equal(await stageHistoryBaseline(source,current,[nextProjected],staged,['engine/backend']),true);
    const weekly=JSON.parse(await readFile(join(staged,'weekly.json'),'utf8'));
    assert.equal(weekly.baseline.report,next.id);assert.deepEqual(weekly.results,results);
    assert.equal(await readFile(join(staged,historical.evidence),'utf8'),await readFile(join(source,historical.evidence),'utf8'));
    const checked=await validateData(staged);
    assert.deepEqual(checked.reports.map(r=>r.runId),[historical.runId,next.runId]);
  }finally{await rm(temporary,{recursive:true,force:true});}
});
test('feature cells do not combine changed engines, native dependencies or launch arguments',async()=>{
  const {featureCandidates,runtimeIdentity}=await import('./lib/feature-support.mjs');
  const runtime={id:'wasmedge',command:['/engine'],file_sha256:{'/engine':'a'},host_file_sha256:{'/sdk/library':'b'},description:{backend:'interpreter'}};
  const old={created:'2026-09-30',runtimes:[runtime],workloads:[{id:'features/simd/one',sha256:'x'},{id:'features/simd/two',sha256:'y'}]};
  const latest={created:'2026-10-01',runtimes:[structuredClone(runtime)],workloads:[{id:'features/simd/one',sha256:'x'}]};
  assert.equal(featureCandidates([latest,old],'wasmedge','features/simd/two','y').length,1);
  latest.runtimes[0].host_file_sha256['/sdk/library']='changed';
  assert.equal(featureCandidates([latest,old],'wasmedge','features/simd/two','y').length,0,'new native library must not inherit an old successful cell');
  assert.notEqual(runtimeIdentity(runtime),runtimeIdentity(latest.runtimes[0]));
  const flags=structuredClone(runtime);flags.command.push('--enable-feature');
  assert.notEqual(runtimeIdentity(runtime),runtimeIdentity(flags));
  const policy=structuredClone(runtime);policy.native_dependency_policy='different closure';
  assert.notEqual(runtimeIdentity(runtime),runtimeIdentity(policy));
});

test('release tracks require exact release evidence and source provenance overrides version strings', async()=>{
  const {releaseTrack,runtimeIdentity}=await import('./lib/feature-support.mjs');
  const runtime={id:'wasmtime',description:{runtime_version:'46.0.1'}};
  const releases={identities:{[runtimeIdentity(runtime)]:{version:'46.0.1',source:'https://example.test/release'}}};
  assert.equal(releaseTrack(runtime,releases).channel,'stable');
  assert.equal(releaseTrack({...runtime,command:['other-binary']},releases).channel,'development');
  const main={...runtime,description:{...runtime.description,effective_configuration:{engine_source_revision:'a'.repeat(40),release_channel:'main'}}};
  const pinned={identities:{[runtimeIdentity(main)]:{version:'46.0.1'}}};
  assert.equal(releaseTrack(main,pinned).channel,'development');
  assert.equal(releaseTrack(main,pinned).version,'a'.repeat(40));
});

test('feature evidence retains separate versions without filling across runtime identities',async()=>{
  const {featureSupport}=await import('./lib/feature-support.mjs');
  const directory=await mkdtemp(join(tmpdir(),'wasm-fyi-feature-versions-'));
  try {
    const workload={id:'features/gc/allocation/64',sha256:'a'.repeat(64),provenance:{scope:'execution'}};
    const runtime=version=>({id:'r',description:{runtime_version:version}});
    const report=(id,created,version)=>({id,created,host:{hostname:'test',os:'test',arch:'test'},runtimes:[runtime(version)],workloads:[workload],evidence:id+'.json'});
    for(const [id,status] of [['stable','ok'],['main','failed']])await writeFile(join(directory,id+'.json'),JSON.stringify({trials:[{workload:workload.id,runtime_configuration:'r',scenario:'steady',status}]}));
    const result=await featureSupport(directory,[report('main','2026-10-02','main-sha'),report('stable','2026-10-01','1.0.0')]);
    const host=result.hosts[0];
    assert.equal(host.versions.length,2);
    assert.equal(host.configurations[0].features.find(f=>f.id==='gc').failed,1);
    assert.equal(host.versions[1].features.find(f=>f.id==='gc').executed,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('feature track passes require the oracle scenario declared by the contract',async()=>{
  const {featureCasePassed}=await import('./lib/feature-support.mjs');
  const compiled={status:'compile-only',scope:'execution',scenarios:['compile']};
  assert.equal(featureCasePassed(compiled),false);
  assert.equal(featureCasePassed({...compiled,scope:'compile-only'}),true);
  assert.equal(featureCasePassed({...compiled,scope:'compile-and-instantiate'}),false);
  assert.equal(featureCasePassed({...compiled,scope:'compile-and-instantiate',scenarios:['compile','instantiate']}),true);
  assert.equal(featureCasePassed({...compiled,status:'executed',scenarios:['compile','first-call']}),false);
  assert.equal(featureCasePassed({...compiled,status:'executed',scenarios:['compile','steady']}),true);
  assert.equal(featureCasePassed({...compiled,status:'failed',scenarios:['compile','steady']}),false);
});


test('changed feature probes cannot inherit archived successes',async()=>{
  const {matchesCurrentFeature}=await import('./lib/feature-support.mjs');
  const id='features/wasi-p1/stdin-read/64',sha256='a'.repeat(64);
  const current=new Map([[id,{id,sha256}]]);
  assert(matchesCurrentFeature({id,sha256},current));
  assert(!matchesCurrentFeature({id,sha256:'b'.repeat(64)},current));
  assert(!matchesCurrentFeature({id:'features/wasi-p1/retired-probe/64',sha256},current));
});

test('staged historical evidence includes the verified external trial and throughput dependencies',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wasm-fyi-history-stage-'));
 try {
  await stageAuxiliary(directory);
  for(const name of ['history','history-hub'])await validateData(join(directory,name));
 } finally {await rm(directory,{recursive:true,force:true});}
});
