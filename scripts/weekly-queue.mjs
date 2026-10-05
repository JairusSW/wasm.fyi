// Prepare a host-local queue item without rebuilding corpus artifacts.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {config,site,digest} from './lib/wasmbench.mjs';
import {readCache,portableWorkloads,atomicJSON} from './lib/benchmark-plan.mjs';
import {performanceCorpusIdentity} from './lib/performance-history.mjs';
import {sharedWeeklySnapshot} from './lib/weekly-calendar.mjs';
const [previousArg,nextArg]=process.argv.slice(2),previous=resolve(previousArg),next=resolve(nextArg);
const pins=JSON.parse(await readFile(join(next,'pins.json'))),calendar=JSON.parse(await readFile(join(site,'data/history-calendar.json')));
sharedWeeklySnapshot(pins,calendar);
const settings=await config(),workloads=(await readCache(site)).filter(w=>!w.id.startsWith('features/'));
const corpus=performanceCorpusIdentity(portableWorkloads(site,workloads)),reused=[];
for(const pin of pins.pins){
 let origin=previous,seen=new Set();
 while(!seen.has(origin)){
  seen.add(origin);
  const receipt=await readFile(join(origin,pin.engine+'-build.json'),'utf8').then(JSON.parse,()=>null);
  if(receipt){
   const plan=JSON.parse(await readFile(join(origin,'sessions',pin.engine,'plan.json')));
   const state=JSON.parse(await readFile(join(origin,'sessions',pin.engine,'state.json')));
   if(['completed','completed-with-failures'].includes(state.status) && receipt.pin.revision===pin.revision && receipt.pin.repository===pin.repository && receipt.harnessRevision==='9332ced5e59c0c3fd9c5aabc6ebc2ed991431eb9' && corpus===performanceCorpusIdentity(plan.jobs.flatMap(j=>j.workloads)) && JSON.stringify(plan.collection)===JSON.stringify({...settings.collection,runtimes:pin.configurations,includeFeatures:false,workers:1}))reused.push({engine:pin.engine,revision:pin.revision,from:origin,cutoffs:[plan.sourcePin.targetWeek,pins.cutoff]});
   break;
  }
  const reuse=await readFile(join(origin,'reuse.json'),'utf8').then(JSON.parse,()=>null),entry=reuse?.reused.find(r=>r.engine===pin.engine);
  if(!entry)break;origin=resolve(site,entry.from??reuse.from);
 }
}
await mkdir(next,{recursive:true});
await atomicJSON(join(next,'reuse.json'),{schema:1,from:previous,context:{corpusSha256:performanceCorpusIdentity(workloads),recipeSha256:digest(JSON.stringify({harness:'9332ced5e59c0c3fd9c5aabc6ebc2ed991431eb9',collection:settings.collection,workers:'25%'}))},reused});
console.log(pins.cutoff+': reused '+reused.map(r=>r.engine).join(', '));
