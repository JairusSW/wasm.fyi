// Verify and append a completed host's exact-source weekly sessions to history.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {site,installDirectory,digest,config} from './lib/wasmbench.mjs';
import {readCache,portableWorkloads} from './lib/benchmark-plan.mjs';
import {performanceCorpusIdentity} from './lib/performance-history.mjs';
import {validateData} from './lib/validate-data.mjs';
import {appendReports,writeIndex} from './lib/snapshot-index.mjs';
import {verifyParentBundle} from './lib/benchmark-bundle.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
const [directoryArg,machine,...selectedEngines]=process.argv.slice(2),directory=resolve(directoryArg);
const engines=selectedEngines.length?selectedEngines:['wago','wazero','wasmtime','v8','wavm','wasmer'];
assert(engines.every(e=>['wago','wazero','wasmtime','v8','wavm','wasmer'].includes(e)),'Unsupported engine');
assert(['local','hub'].includes(machine),'Expected local or hub');
const dataset=join(site,'data',machine==='local'?'history':'history-hub');
const previous=await validateData(dataset),weekly=JSON.parse(await readFile(join(dataset,'weekly.json')));
const pins=JSON.parse(await readFile(join(directory,'pins.json'))),cutoff=new Date(pins.cutoff).toISOString();
let target=weekly.results.find(w=>new Date(w.targetWeek).toISOString()===cutoff);
if(!target){target={targetWeek:pins.cutoff,revision:pins.pins.find(p=>p.engine==='wago').revision,status:'measured',engines:{}};weekly.results.push(target);}
const reuse=await readFile(join(directory,'reuse.json'),'utf8').then(JSON.parse,()=>null);
const staged=await mkdtemp(join(site,'data','.weekly-'));
try {
 await cp(dataset,staged,{recursive:true});
 let merged=previous.reports;
 const oldWago=previous.reports.find(r=>r.runId===target.reports?.[0]?.runId || r.runId===target.runId)?.runtimes.find(r=>r.id==='wago');
 target.engines ??= {wago:{revision:target.revision,status:target.status,collectedAt:target.collectedAt,reports:target.reports || [{runId:target.runId,collectedAt:target.collectedAt,reportSha256:target.reportSha256}],runtimeVersion:oldWago?.description.runtime_version,backend:oldWago?.description.backend}};
 for(const engine of engines) {
  if(reuse?.reused.some(r=>r.engine===engine)){
   const pin=pins.pins.find(p=>p.engine===engine),sourceDirectory=resolve(site,reuse.from),session=join(sourceDirectory,'sessions',engine);
   const plan=JSON.parse(await readFile(join(session,'plan.json'))),state=JSON.parse(await readFile(join(session,'state.json'))),receipt=JSON.parse(await readFile(join(sourceDirectory,engine+'-build.json')));
   assert(['completed','completed-with-failures'].includes(state.status),'Reuse requires completed corpus jobs');
   assert.equal(pin.revision,plan.sourcePin.revision,'Reuse source hash differs');
   assert.equal(pin.repository,plan.sourcePin.repository,'Reuse source repository differs');
   assert.equal(plan.sourceReceiptSha256,digest(await readFile(join(sourceDirectory,engine+'-build.json'))));
   assert.equal(receipt.harnessRevision,'9332ced5e59c0c3fd9c5aabc6ebc2ed991431eb9');
   assert.equal(state.machine,machine,'Reuse machine differs');
   const settings=await config();assert.deepEqual(plan.collection,{...settings.collection,runtimes:pin.configurations,includeFeatures:false,workers:1},'Reuse measurement recipe differs');
   const cached=portableWorkloads(site,(await readCache(site)).filter(w=>!w.id.startsWith('features/')));
   assert.equal(performanceCorpusIdentity(plan.jobs.flatMap(j=>j.workloads)),performanceCorpusIdentity(cached),'Reuse corpus or oracle differs');
   await verifyParentBundle(join(session,'bundle'),plan);
   const origin=weekly.results.find(w=>new Date(w.targetWeek).toISOString()===new Date(plan.sourcePin.targetWeek).toISOString());
   const point=origin?.engines?.[receipt.runtime.id];assert(point?.reports?.length,'Reuse evidence has not been published');
   for(const ref of point.reports)assert(previous.reports.some(r=>r.runId===ref.runId&&r.sourceReportSha256===ref.reportSha256&&r.created===ref.collectedAt),'Reuse report reference differs');
   target.engines[receipt.runtime.id]={...point,source:pin,reusedFrom:origin.targetWeek};
   console.log(engine,machine,pin.revision.slice(0,12),'unchanged source: reused existing report and bundle references');
   continue;
  }
  const session=join(directory,'sessions',engine),plan=JSON.parse(await readFile(join(session,'plan.json')));
  const state=JSON.parse(await readFile(join(session,'state.json'))),receipt=JSON.parse(await readFile(join(directory,engine+'-build.json')));
  const qualification=JSON.parse(await readFile(join(session,'qualification.json')));
  assert.equal(qualification.pin.revision,receipt.pin.revision);
  const description=qualification.description;
  assert.equal(plan.sourceReceiptSha256,digest(await readFile(join(directory,engine+'-build.json'))),'Build receipt changed during collection');
  assert.equal(receipt.pin.revision,plan.sourcePin.revision);
  assert.equal(receipt.harnessRevision,'9332ced5e59c0c3fd9c5aabc6ebc2ed991431eb9','Harness revision differs');
  assert(['completed','completed-with-failures'].includes(state.status),'Collection is incomplete: '+engine);
  const paths=[];
  for(const job of plan.jobs){
   const result=JSON.parse(await readFile(join(session,'jobs',job.id,'result.json')));
   assert.equal(result.plan,plan.identity);assert.deepEqual(result.workloads,job.workloads.map(w=>w.id));
   for(const path of result.reports){assert(path.startsWith('jobs/')&&!path.split('/').includes('..'),'Unsafe report path');paths.push(join(session,path));}
  }
  await verifyParentBundle(join(session,'bundle'),plan);
  const incoming=join(directory,'imported-'+engine);
  await runCommand(process.execPath,[join(site,'scripts/import-wasmbench.mjs'),'--output',incoming,...paths],{env:{...process.env,WASMBENCH_ROOT:receipt.root,WASMBENCH_BIN:receipt.controller},quiet:true});
  const imported=await validateData(incoming),runtime=receipt.runtime.id;
  imported.reports.sort((a,b)=>b.created.localeCompare(a.created));
  for(const report of imported.reports){
   assert.equal(report.host.os,machine==='local'?'darwin':'linux');
   assert.equal(report.runtimes.length,1);assert.equal(report.runtimes[0].id,runtime);
   assert.equal(report.runtimes[0].description.runtime_version,description.runtime_version);
   for(const w of report.workloads)assert(plan.jobs.some(j=>j.workloads.some(expected=>expected.id===w.id&&expected.sha256===w.sha256)),'Artifact differs from pinned plan');
  }
  assert.equal(new Set(imported.reports.flatMap(r=>r.workloads.map(w=>w.id))).size,168,'Missing workload evidence');
  merged=appendReports(merged,imported.reports);
  for(const report of imported.reports)for(const name of [report.evidence,report.trialsEvidence,report.throughputEvidence])if(name)await cp(join(incoming,name),join(staged,name));
  target.engines[runtime]={revision:plan.sourcePin.revision,runtimeVersion:description.runtime_version,backend:description.backend,status:'measured',collectedAt:imported.reports[0].created,
   source:plan.sourcePin,harnessRevision:receipt.harnessRevision,reports:imported.reports.map(r=>({runId:r.runId,collectedAt:r.created,reportSha256:r.sourceReportSha256}))};
  const retained=join(site,'data/benchmark-runs',plan.id,machine);await mkdir(retained,{recursive:true});
  await cp(join(session,'bundle'),join(retained,'bundle'),{recursive:true});
  for(const [file,from] of [['plan.json',join(session,'plan.json')],['qualification.json',join(session,'qualification.json')],['build.json',join(directory,engine+'-build.json')],['state.json',join(session,'state.json')]])await cp(from,join(retained,file));
  console.log(engine,machine,plan.sourcePin.revision.slice(0,12),imported.reports.length,'sealed reports retained');
 }
 // Keep the legacy Wago fields useful to older consumers while exposing all six pins.
 if(target.engines.wago)Object.assign(target,{revision:target.engines.wago.revision,collectedAt:target.engines.wago.collectedAt,reports:target.engines.wago.reports});
 delete target.runId;delete target.reportSha256;
 weekly.results.sort((a,b)=>+new Date(a.targetWeek)-+new Date(b.targetWeek));weekly.weeks=weekly.results.map(w=>w.targetWeek);
 weekly.policy='History is ordered by source snapshot or release publication date. Weekly engines are pinned to the last default-branch commit before Saturday 11:59 PM America/New_York. V8 uses the V8 vendored in the pinned Node source. Unchanged source hashes reuse existing evidence on the same machine with the same corpus and measurement recipe. Actual collection timestamps and all 168 non-feature artifact hashes are retained.';
 await writeIndex(staged,merged);await writeFile(join(staged,'weekly.json'),JSON.stringify(weekly,null,2)+'\n');await validateData(staged);
 const finish=await installDirectory(staged,dataset);await finish(false);
 console.log('Verified weekly history published locally for',machine);
} finally {await rm(staged,{recursive:true,force:true});}
