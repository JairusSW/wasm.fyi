import assert from 'node:assert/strict';
import {readFile,mkdir,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
import {atomicJSON,planIdentity} from './benchmark-plan.mjs';
import {publicationURL,publishCompletedJob,registerSessionPlan} from './api-publish.mjs';
import {retainCollectionParent} from './benchmark-parent-bundle.mjs';
import {collectionVerdict} from './collection-verdict.mjs';
import {assertHistoricalRuntime} from './historical-binding.mjs';
import {performanceCorpusIdentity} from './performance-history.mjs';
import {runCommand} from './benchmark-process.mjs';
import {fileURLToPath} from 'node:url';
import {processLock} from './benchmark-lock.mjs';
const HASH=/^[a-f0-9]{64}$/;
const REVISION=/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
function recordedTime(value) {
  assert(typeof value==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T|$)/.test(value)&&Number.isFinite(Date.parse(value)),'Invalid historical time');
  const date=value.slice(0,10);
  assert(date.slice(0,4)!=='0000'&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'Invalid historical calendar day');
  return new Date(value).toISOString();
}

export function historicalAPIBinding({job,entry,reportId,configurationId}) {
  assert(entry.status==='collected'&&entry.id===entry.binding?.configuration,'Incomplete historical configuration');
  assert(HASH.test(reportId)&&HASH.test(configurationId),'Invalid historical producer identity');
  const pin=job.release;
  assert(pin&&entry.binding.release?.tag===pin.tag&&entry.binding.engine===pin.engine,'Historical source binding differs');
  assert(entry.binding.release.repository===pin.repository&&entry.binding.release.publishedAt===pin.publishedAt,'Historical release provenance differs');
  const dates=[...(job.targetWeeks||[]),...(job.targetReleases||[]).map(release=>release.publishedAt)].map(value=>{
    return recordedTime(value).slice(0,10);
  });
  const targets=[...new Set(dates)].sort();assert(targets.length>0&&targets.length<=256,'Historical aliases exceed bounds');
  const binding={reportId,configurationId,policy:'declared-build-history-v1',targetDates:targets,buildRole:pin.targetType==='main'?'source':'release'};
  const revision=entry.binding.source?.revision;
  if(revision!==undefined){assert(REVISION.test(revision),'Invalid actual historical source revision');binding.sourceRevision=revision;}
  if(binding.buildRole==='source') {
    assert(revision===pin.revision,'Historical default-branch source differs');
    if(pin.committedAt)binding.sourceDate=recordedTime(pin.committedAt);
  } else {
    assert(['weekly','release',undefined].includes(pin.targetType),'Unknown historical build role');
    const url=new URL(pin.url);
    assert(url.protocol==='https:'&&!url.username&&!url.password&&pin.tag&&Number.isFinite(Date.parse(pin.publishedAt)),'Invalid historical release association');
    binding.release={version:pin.tag,publishedAt:recordedTime(pin.publishedAt),url:pin.url};
    if(pin.datePrecision!==undefined){
      assert(['day','second'].includes(pin.datePrecision),'Unknown recorded release precision');
      assert(pin.datePrecision!=='day'||binding.release.publishedAt.endsWith('T00:00:00.000Z'),'Day precision requires its UTC day boundary');
      assert(pin.datePrecision!=='second'||binding.release.publishedAt.endsWith('.000Z'),'Second precision cannot describe fractional seconds');
      binding.release.datePrecision=pin.datePrecision;
    }
  }
  return binding;
}

// Resolve the exact configuration from producer records, never by reserializing
// runtime descriptions or treating a display lane as an exact build identity.
async function configurationIdentity(directory,manifest,configuration,signal) {
  assert(manifest.schema===2&&manifest.format==='site-v2'&&manifest.verification==='source-recomputed'&&HASH.test(manifest.reportId),'Invalid historical producer export');
  assert(Array.isArray(manifest.objects)&&manifest.objects.length<=512&&Array.isArray(manifest.inventoryPages||[])&&(manifest.inventoryPages||[]).length<=512,'Unbounded historical inventory');
  const readObject=async object=>{
    signal?.throwIfAborted();
    assert(HASH.test(object.sha256)&&Number.isSafeInteger(object.bytes)&&object.bytes>0&&object.bytes<=256*1024,'Invalid historical record commitment');
    const path=join(directory,'objects',object.sha256),info=await stat(path);
    assert(info.isFile()&&info.size===object.bytes,'Historical object size differs');
    const bytes=await readFile(path);assert(bytes.length===object.bytes&&digest(bytes)===object.sha256,'Historical object differs');
    return JSON.parse(bytes);
  };
  const pages=[manifest.objects];
  for(const page of manifest.inventoryPages||[]) {
    const inventory=await readObject(page);
    assert(inventory.schema===1&&Array.isArray(inventory.objects)&&inventory.objects.length===page.objects&&page.objects>0&&page.objects<=512,'Historical inventory commitment differs');
    assert(inventory.objects.reduce((total,object)=>total+object.bytes,0)===page.contentBytes,'Historical inventory bytes differ');
    pages.push(inventory.objects);
  }
  let id;
  for(const objects of pages)for(const object of objects) {
    if(object.kind!=='record')continue;
    const record=await readObject(object);
    if(record.kind==='configuration'&&record.data.id===configuration) {
      assert(HASH.test(record.id)&&id===undefined,'Ambiguous historical exact configuration');id=record.id;
    }
  }
  assert(id,'Historical export lacks its exact configuration');return id;
}

// Called only for an already completed, verified configuration in the existing
// history queue. Publication failures leave its measurements reusable on resume.
export async function publishPerformanceHistoryConfiguration({directory,queue,job,entry,workloads,configuredHarnessPin,url,invoke,signal,request,token}) {
  signal?.throwIfAborted();
  assert(entry.status==='collected'&&entry.report&&HASH.test(entry.sha256)&&entry.collectedAt,'Historical measurements are incomplete');
  assert(queue.jobs.some(candidate=>candidate.id===job.id)&&job.identity.configurations.includes(entry.id),'Historical job outside its queue');
  assert.equal(performanceCorpusIdentity(workloads),queue.corpusSha256,'Historical workload contracts changed');
  assert(/^[a-f0-9]{40}$/.test(configuredHarnessPin),'Missing configured harness pin');
  await invoke('verify-report','--dir',entry.report);
  const bytes=await readFile(join(entry.report,'data.json'));assert.equal(digest(bytes),entry.sha256,'Historical source report changed');
  const data=JSON.parse(bytes),manifest=data.bundle.manifest,runtimes=manifest.lock.runtime_configurations;
  assert(runtimes.length===1,'Historical source has multiple configurations');assertHistoricalRuntime(runtimes[0],entry.binding);
  assert.equal(queue.host,manifest.host.os+'/'+manifest.host.arch,'Historical source environment differs');
  assert(manifest.lock.workloads.length===workloads.length&&manifest.lock.workloads.every(source=>workloads.some(workload=>workload.id===source.id&&workload.sha256===source.sha256)),'Historical source workload population differs');
  const machine=queue.host.replace('/','-');
  const packer=fileURLToPath(new URL('../pack-history-parent.py',import.meta.url));
  const packing=JSON.parse((await runCommand('python3',[packer,'--describe'],{signal})).output);
  packing.scriptSha256=digest(await readFile(packer));
  const sourceSeal=await readFile(join(entry.report,'checksums.json'));
  const plan={schema:1,engines:[entry.id],machines:[{name:machine,workers:1}],jobs:[{id:'corpus-0001',workloads:manifest.lock.workloads}],collection:queue.options,
    configuredHarnessPin,recordedRunner:{version:manifest.lock.runner_version,sha256:manifest.lock.runner_sha256},publication:{type:'api-v1',url:publicationURL(url)},
    historyCapture:{scope:'retrospective-completed-configuration',job:job.id,sourceReportSha256:entry.sha256,sourceSealSha256:digest(sourceSeal),binding:entry.binding,parentPacking:packing}};
  plan.identity=planIdentity(plan);plan.id='history-'+plan.identity;
  const local=join(directory,'api',plan.id),path='jobs/corpus-0001/exports/report/site-v2',exportDirectory=join(local,path);
  await mkdir(local,{recursive:true});
  return processLock(join(local,'publication.lock'),async()=>{
  signal?.throwIfAborted();
  // Only this publisher owns these retrospective-scope directories. The
  // process lease proves any earlier writer has stopped before repairing its
  // abandoned child lock; live competing publishers wait on the same lease.
  await rm(join(local,'bundle.lock'),{force:true});
  const existing=await readFile(join(local,'plan.json'),'utf8').then(JSON.parse,error=>{if(error.code!=='ENOENT')throw error;return null});
  if(existing)assert.equal(planIdentity(existing),plan.identity,'Historical publication scope changed');else await atomicJSON(join(local,'plan.json'),plan);
  const publication={url:plan.publication.url,signal,request,token};
  await registerSessionPlan({...publication,plan});
  // The sealed report retains its exact original timing bundle under raw/.
  await retainCollectionParent({root:local,log:join(local,'commands.log'),bundle:join(entry.report,'raw'),profile:'timing',plan,host:{name:machine,workers:1},env:{NODE_OPTIONS:''},signal,
    packing,pack:(source,output)=>runCommand('python3',[packer,'--source',source,'--output',output],{signal,log:join(local,'commands.log')}),
    workerPolicy:{workers:manifest.lock.options.workers??null,goThreads:null,rayonThreads:null,openmpThreads:null,nodeOptions:null,cpuAffinity:'not recorded; no affinity inference',source:'historical locked pass; thread environment not independently captured'}});
  const exportExists=await stat(join(exportDirectory,'manifest.json')).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false});
  if(!exportExists){await mkdir(join(local,'jobs/corpus-0001/exports/report'),{recursive:true});await invoke('export-site','--report',entry.report,'--out',exportDirectory);}
  const exported=JSON.parse(await readFile(join(exportDirectory,'manifest.json'))),seal=await readFile(join(entry.report,'checksums.json'));
  assert(exported.sourceReportSha256===entry.sha256&&exported.sourceSealSha256===digest(seal),'Historical export source changed');
  const configurationId=await configurationIdentity(exportDirectory,exported,entry.id,signal);
  const historyBindings=[historicalAPIBinding({job,entry,reportId:exported.reportId,configurationId})];
  const result={plan:plan.identity,corpus:'corpus-0001',siteExports:[path],finished:entry.collectedAt,verdict:collectionVerdict(data.summaries||[]),historyBindings};
  const revision=await publishCompletedJob({...publication,local,plan,machine,result});
  return {status:'published',revision,session:plan.id,plan:plan.identity};
  });
}
