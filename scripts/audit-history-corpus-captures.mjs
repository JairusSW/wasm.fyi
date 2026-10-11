import {qualifiedNativeCode} from './lib/qualification-capture.mjs';
import {adaptivePolicy} from './lib/adaptive-sampling.mjs';
import {historyPinAllowed} from './lib/history-window.mjs';
// Audit actual compact captures against every planned source/configuration and
// shared artifact. A subprocess completion counter is not coverage evidence.
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {atomicJSON} from './lib/benchmark-plan.mjs';
const [rootArg,selectedEngine]=process.argv.slice(2),root=resolve(rootArg);
const plan=JSON.parse(await readFile(join(root,'source-plan.json'))),template=JSON.parse(await readFile(join(root,'collection-template.json')));
const grouped=template.collection.adaptiveSampling===true||[10,25,35].includes(template.collection.adaptiveSampling?.maxSamples);
const adaptive=grouped?null:adaptivePolicy(template.collection.adaptiveSampling);
const validSampleCount=(n,row)=>grouped?Number.isInteger(n)&&n>=5&&n<=(row.sampling?.maxSamples||35)&&[10,25,35].includes(row.sampling?.maxSamples||35)&&n%5===0:adaptive?Number.isInteger(n)&&n>=adaptive.minLaunches*5&&n<=adaptive.maxLaunches*5&&n%5===0:n===audit.minimumSamples;
const workloads=new Map(template.workloads.map(w=>[w.id,w.sha256])),phases=['compile','instantiate','first-call','steady'];
const key=(configuration,kind,ref,date)=>[configuration,kind,ref,new Date(date).toISOString()].join('|');
const expected=new Map();
for(const pin of plan.pins.filter(p=>historyPinAllowed(p,template)&&['planned','reused'].includes(p.status)&&(!selectedEngine||p.engine===selectedEngine)))for(const configuration of pin.configurations){
 const identity=pin.targetType==='release'?pin.tag:pin.revision;
 expected.set(key(configuration,pin.targetType,identity,pin.targetWeek),{engine:pin.engine,configuration,kind:pin.targetType,ref:identity,asOf:pin.targetWeek,repository:pin.repository,revision:pin.revision,dateBasis:pin.dateBasis});
}
const audit={started:new Date().toISOString(),historyNotBefore:template.historyNotBefore||null,scope:'Actual capture/artifact/sample/resource audit; CPU affinity and catalog completeness are separate requirements',minimumSamples:plan.minimumSamples||plan.samples||template.collection.samples,artifacts:workloads.size,machines:[]};
const mirror=async name=>await readdir(join(root,'machines',name,'captures')).then(()=>join(root,'machines',name,'captures'),()=>join(root,name,'captures'));
for(const [machine,directory] of [[template.machine,join(root,'captures')],['hub@hub',await mirror('hub')],['root@remote',await mirror('remote')]]){
 const found=new Map(),errors=[],statuses={},resourceGaps=[];
 let captures=0;
 for(const file of await readdir(directory).catch(()=>[])){
  if(!file.endsWith('.json'))continue;
  try{
   const capture=JSON.parse(await readFile(join(directory,file))),source=capture.source;
   if(!source||!capture.results?.length)throw Error('Missing capture source or measurements');
   const kind=source.kind==='release'?'release':'main',identity=kind==='release'?source.ref:source.revision;
   const configurations=new Set(capture.results.map(r=>r.engine));
   if(configurations.size!==1)throw Error('Mixed configurations in source capture');
   const target=key([...configurations][0],kind,identity,source.asOf),pin=expected.get(target);
   if(!pin)continue;
   if(source.repository!==pin.repository||(pin.revision&&source.revision!==pin.revision)||(pin.dateBasis&&source.dateBasis!==pin.dateBasis))throw Error('Capture differs from planned source identity');
   const artifact=capture.results[0].workload,hash=workloads.get(artifact);
   if(!hash||capture.results.length!==4)throw Error('Unexpected artifact or phase count');
   for(const phase of phases){
    const row=capture.results.find(r=>r.phase===phase);
    if(!row?.version||row.version==='unknown')throw Error('Runtime startup failed before version qualification');
    if(!row||row.workload!==artifact||row.artifactSha256!==hash)throw Error('Shared artifact or required phase differs');
    if(!['ok','failed','unsupported'].includes(row.latencyStatus))throw Error('Timing phase was not captured');
    if(row.latencyStatus==='ok'&&(!Number.isSafeInteger(row.timingSamples)||!validSampleCount(row.timingSamples,row)||row.samplesNs?.length!==row.timingSamples||row.samplesNs.some(n=>!Number.isFinite(n)||n<0)||!Number.isFinite(row.latencyNs)||row.latencyNs<0))throw Error('Successful phase lacks the requested retained verified samples');
    if(row.latencyStatus==='ok'){
     const memory=row.memoryStatus==='ok'&&Number.isSafeInteger(row.peakRssBytes)&&row.peakRssBytes>0;
     const code=qualifiedNativeCode(row);
     if(!memory||!code)resourceGaps.push({file,phase,memory,code});
    }
    statuses[row.latencyStatus]=(statuses[row.latencyStatus]||0)+1;
   }
   if(!Number.isSafeInteger(capture.platform?.memoryBytes)||capture.platform.memoryBytes<=0)throw Error('Physical platform RAM missing');
   const artifacts=found.get(target)||new Set();if(artifacts.has(artifact))throw Error('Duplicate source/configuration/artifact capture');artifacts.add(artifact);found.set(target,artifacts);captures++;
  }catch(error){errors.push({file,error:String(error)});}
 }
 const targets=[...expected].map(([id,pin])=>{const artifacts=found.get(id)||new Set();return {...pin,captures:artifacts.size,missing:[...workloads.keys()].filter(w=>!artifacts.has(w))};});
 const completeTargets=targets.filter(t=>!t.missing.length).length;
 audit.machines.push({machine,captures,expectedTargets:expected.size,completeTargets,incompleteTargets:expected.size-completeTargets,statuses,errors,resourceGaps,targets});
 console.log(JSON.stringify({machine,captures,expectedTargets:expected.size,completeTargets,errors:errors.length,resourceGaps:resourceGaps.length,statuses}));
}
audit.completed=new Date().toISOString();
await atomicJSON(join(root,selectedEngine?selectedEngine+'-corpus-capture-audit.json':'corpus-capture-audit.json'),audit);
