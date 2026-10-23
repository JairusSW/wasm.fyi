import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {classifyFeatureCapture,classifyFeatureRuntimeRejection,featureFailureRecords} from './lib/feature-unsupported.mjs';

const read=async path=>JSON.parse(await readFile(path,'utf8'));
const sameSource=(a,b)=>['repository','revision','asOf'].every(key=>a?.[key]===b?.[key]);
const keyFromName=name=>name.match(/-([a-f0-9]{64})\.json$/)?.[1];
const outcomes=capture=>capture.results.map(row=>[row.phase,row.latencyStatus]);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export async function reconcileFeatureClassifications({campaign,ledgerDirectory,inputs,write=false,clock=()=>new Date()}){
 campaign=resolve(campaign);ledgerDirectory=resolve(ledgerDirectory);inputs=resolve(inputs);
 const ledgerPath=join(ledgerDirectory,'ledger.json'),ledger=await read(ledgerPath),captureDirectory=join(campaign,'captures'),captureDirectories=[...new Set([captureDirectory,join(ledgerDirectory,'captures')].map(path=>resolve(path)))];
 const workloads=new Map();
 for(const stage of ['compatibility','performance','compile','lifecycle'])for(const workload of await read(join(inputs,stage+'.json')))workloads.set(stage+'\0'+workload.id,workload);
 const index=new Map();
 for(const directory of captureDirectories)for(const name of await readdir(directory).catch(()=>[])){const key=keyFromName(name);if(key){const list=index.get(key)||[],path=join(directory,name);if(!list.some(entry=>entry.path===path))list.push({name,path});index.set(key,list)}}
 let inspected=0,reclassified=0,updatedFailures=0,reaffirmed=0,ignoredIntegration=0;const unresolved=[];
 for(const [key,item] of Object.entries(ledger.items||{})){
  const workload=workloads.get(item.stage+'\0'+item.workload);if(!workload||workload.sha256!==item.artifactSha256)continue;
  const candidates=[],ignored=[];
  for(const entry of index.get(key)||[]){
   const {name,path}=entry,capture=await read(path).catch(()=>null);if(!capture?.results?.length||!sameSource(capture.source,item.source))continue;
   if(capture.results.some(row=>row.engine!==item.engine||row.workload!==item.workload||row.artifactSha256!==item.artifactSha256||row.contractSha256!==item.contractSha256))continue;
   let note=await read(join(campaign,'failure-notes',name)).catch(()=>read(join(ledgerDirectory,'failure-notes',name)).catch(()=>null));
   // Reaffirmation replays intentionally do not duplicate sidecar failure
   // notes. The selected ledger item retains the exact paired diagnostic, so
   // use it when revisiting that capture under newer source-bound rules.
   if(name===item.capture&&item.failure)note=item.failure;
   if(note?.capturedAt&&note.capturedAt!==capture.capturedAt)note=null;
   const disposition=note&&classifyFeatureRuntimeRejection({source:item.source,engine:item.engine,workload,capture,failures:featureFailureRecords(note,{engine:item.engine,workload,capture})});
   // A controller/admission failure is not a runtime observation and must not
   // supersede a completed result merely because a stopped retry wrote later.
   if(note?.kind==='capture-error'&&!disposition){ignoredIntegration++;ignored.push({name,capture,note});continue}
   candidates.push({name,capture,note,disposition});
  }
  if(!candidates.length)continue;inspected++;
  const latest=new Map();
  for(const candidate of candidates)for(const row of candidate.capture.results){const old=latest.get(row.phase);if(!old||candidate.capture.capturedAt>old.capture.capturedAt)latest.set(row.phase,candidate)}
  const actual=[...latest].map(([phase,candidate])=>[phase,candidate.capture.results.find(row=>row.phase===phase).latencyStatus]);
  const ordered=(item.outcomes||[]).map(([phase,status])=>[phase,new Map(actual).get(phase)||status]);
  const desired=new Map(item.outcomes||[]),newestValid=[...new Set([...latest.values()])].sort((a,b)=>a.capture.capturedAt.localeCompare(b.capture.capturedAt)).at(-1);
  const ambiguous=candidates.some(candidate=>candidate.capture.results.some(row=>desired.has(row.phase)&&row.latencyStatus!==desired.get(row.phase)&&candidate.capture.capturedAt>=latest.get(row.phase).capture.capturedAt));
  const needsReaffirm=ambiguous||ignored.some(candidate=>candidate.capture.capturedAt>=newestValid.capture.capturedAt);
  const hasClassifiableFailure=(item.outcomes||[]).some(([,status])=>status==='failed')&&candidates.some(candidate=>candidate.disposition);
  if(equal(ordered,item.outcomes)&&!needsReaffirm&&!hasClassifiableFailure)continue;
  const newest=newestValid,used=[...new Set([...latest.values()])];
  const combined={...newest.capture,results:(item.outcomes||[]).map(([phase])=>latest.get(phase)?.capture.results.find(row=>row.phase===phase)).filter(Boolean)};
  const notes=used.map(candidate=>candidate.note).filter(Boolean);
  const failures=notes.flatMap(note=>featureFailureRecords(note,{engine:item.engine,workload,capture:combined}));
  const disposition=failures.length&&classifyFeatureRuntimeRejection({source:item.source,engine:item.engine,workload,capture:combined,failures});
  const classified=disposition&&classifyFeatureCapture(combined,disposition),reconciled=classified||combined;
  reconciled.capturedAt=clock().toISOString();
  const digest=createHash('sha256').update(JSON.stringify(reconciled)).digest('hex').slice(0,16),name=`feature-${classified?'classified-':''}replay-${digest}-${item.engine}-${key}.json`;
  if(write){await atomicJSON(join(captureDirectory,name),reconciled);const secondary=join(ledgerDirectory,'captures',name);if(resolve(secondary)!==resolve(join(captureDirectory,name)))await atomicJSON(secondary,reconciled)}
  if(classified){
   ledger.items[key]={...item,capture:name,outcomes:outcomes(classified),classifiedFrom:newest.name,classifiedSources:used.map(candidate=>candidate.name),classification:disposition,finished:classified.capturedAt};delete ledger.items[key].failure;reclassified++;
  }else{
   ledger.items[key]={...item,capture:name,outcomes:outcomes(reconciled),finished:reconciled.capturedAt,...(notes.length?{failure:{kind:'reconciled-latest-failures',failures}}:{})};updatedFailures++;
   if(needsReaffirm&&equal(ordered,item.outcomes)){reaffirmed++;delete ledger.items[key].failure}
   else unresolved.push({engine:item.engine,stage:item.stage,workload:item.workload,capture:name,from:used.map(candidate=>candidate.name),outcomes:outcomes(reconciled)});
  }
 }
 if(write&&(reclassified||updatedFailures))await atomicJSON(ledgerPath,ledger);
 return {inspected,reclassified,updatedFailures,reaffirmed,ignoredIntegration,unresolved};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [campaign,ledgerDirectory,inputs]=process.argv.slice(2);if(!campaign||!ledgerDirectory||!inputs)throw Error('Usage: reconcile-feature-classifications.mjs CAMPAIGN LEDGER_DIRECTORY INPUTS [--write]');
 const result=await reconcileFeatureClassifications({campaign,ledgerDirectory,inputs,write:process.argv.includes('--write')});
 if(process.argv.includes('--verbose'))console.log(JSON.stringify(result));
 else{
  const unresolvedByEngine={};for(const row of result.unresolved)unresolvedByEngine[row.engine]=(unresolvedByEngine[row.engine]||0)+1;
  console.log(JSON.stringify({...result,unresolved:undefined,unresolvedCount:result.unresolved.length,unresolvedByEngine}));
 }
}
