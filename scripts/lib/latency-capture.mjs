import {workloadContract} from './workload-contract.mjs';
import {samplePolicy,sampleStability} from './sample-stability.mjs';
import {collectFeatureBatches} from './feature-timing.mjs';
import {identifyEngineFatals} from './engine-fatal-reason.mjs';
import {readFile,readdir,mkdir,rm,writeFile,open} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {digest} from './wasmbench.mjs';
import {parseCorpusJSON} from './corpus.mjs';
import {collectCallBatches,callBatchOperations,CALL_LOOP_WORKLOAD,CALL_LOOP_ITERATIONS} from './call-timing.mjs';

const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=sorted.length>>1;return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const phases=['compile','instantiate','first-call','steady'];
export function latencyIdentity(capture){const p=capture.platform;return digest(Buffer.from(JSON.stringify([p.os,p.arch,p.cpu,p.cores,p.kernel,p.memoryBytes||0,...capture.results.map(r=>r.workload+'|'+r.engine+'|'+r.phase).sort()])))}
export const latencyCollection=collection=>({adaptiveSampling:samplePolicy,phaseSampleCaps:samplePolicy.phaseSampleCaps,...collection,capture:'latency',memory:true,code:true,timingPeakRSS:true,phaseBarriers:false});

// Only the measurement inputs and correctness checks are needed while running.
// Keep only normalized, verified latency samples; raw trials remain temporary.
export function summarizeLatencies({manifest,trials,workloads,engines,scenarios=phases}) {
 const platform=manifest.host;
 const configurations=manifest.lock.runtime_configurations;
 const results=[];
 for(const workload of workloads)for(const engine of engines)for(const phase of scenarios) {
  const matching=trials.filter(t=>t.runtime_configuration===engine&&t.workload===workload.id);
  const all=matching.filter(t=>t.profile==='timing');
  const measured=all.filter(t=>t.profile==='timing'&&t.scenario===phase&&t.block>=0);
  const failures=all.filter(t=>!['ok','unsupported','disabled'].includes(t.status));
  const launches=[],samplesNs=[];
  for(const trial of measured.filter(t=>t.status==='ok')) {
   const values=(trial.samples||[]).filter(s=>!s.warmup&&s.verified&&Number.isSafeInteger(s.operations)&&s.operations>0&&Number.isSafeInteger(s.elapsed_ns)&&s.elapsed_ns>=0).map(s=>s.elapsed_ns/s.operations);
   if(values.length){launches.push(median(values));samplesNs.push(...values);}
  }
  const rejected=measured.some(t=>!['ok','unsupported','disabled'].includes(t.status));
  const status=failures.length||rejected?'failed':launches.length?'ok':measured.some(t=>t.status==='unsupported')?'unsupported':measured.some(t=>t.status==='disabled')?'disabled':'not-measured';
  const cfg=configurations.find(c=>c.id===engine);
  if(!cfg)throw Error(`Missing recorded engine identity: ${engine}`);
  const divisor=workload.id===CALL_LOOP_WORKLOAD&&phase==='steady'?CALL_LOOP_ITERATIONS:1;
  const display={group:workload.provenance?.category||workload.family||workload.id.split('/')[1]||'Other workloads',purpose:workload.original_contract?.desc||workload.provenance?.description||'',tags:[...new Set([...(workload.features||[]),...(workload.original_contract?.tags||[]),...(workload.provenance?.baseline?['baseline']:[])])],abi:workload.abi||'',bytes:workload.bytes||0,source:workload.source||'',reset:workload.reset||''};
  const timingSamples=status==='ok'?samplesNs.length:0;
  const adaptive=status==='ok'&&measured.some(t=>t.sampling?.method==='same-process-stability-v1')?sampleStability(samplesNs,measured.find(t=>t.sampling?.maxSamples)?.sampling.maxSamples||35):null;
  results.push({display,timingSamples,...(status==='ok'?{samplesNs:samplesNs.map(value=>value/divisor),...(adaptive?{sampling:{method:'same-process-stability-v1',groupSize:5,maxSamples:measured.find(t=>t.sampling?.maxSamples)?.sampling.maxSamples||35,warmup:0,retainedStart:adaptive.retainedStart,stopReason:adaptive.reason}}:{})}:{}),workload:workload.id,wasm:workload.artifactName||basename(workload.artifact),artifactSha256:workload.sha256,contractSha256:workloadContract(workload),engine,version:cfg.description?.runtime_version||cfg.version||'unknown',backend:cfg.description?.backend||cfg.backend||engine,phase,latencyStatus:status,latencyNs:status==='ok'?(adaptive?adaptive.medianNs:median(launches))/divisor:null,...summarizeResources(matching,phase)});
 }
 return {capturedAt:new Date().toISOString(),...(process.env.WASMBENCH_SOURCE_JSON?{source:JSON.parse(process.env.WASMBENCH_SOURCE_JSON)}:{}),platform:{os:platform.os,arch:platform.arch,cpu:platform.cpu_description||'unknown',cores:platform.logical_cpus,kernel:platform.kernel||'',...(platform.memory_bytes?{memoryBytes:platform.memory_bytes}:{})},results};
}

// Kernel peak RSS comes from timing-process exit; code needs one cold compile.
export function summarizeResources(trials,phase) {
 const out={memoryStatus:'not-measured',peakRssBytes:null,codeStatus:'not-measured',codeBytes:null,codeKind:null};
 for(const [profile,scenario,field,statusField,metric] of [['memory',phase,'peakRssBytes','memoryStatus','process.peak_rss'],['code','compile','codeBytes','codeStatus','native.code_image']]) {
  const all=trials.filter(t=>t.profile===profile||(t.profile==='timing'&&(profile==='memory'?(t.observations||[]).some(o=>o.metric===metric):[...(t.observations||[]),...(t.samples||[]).filter(s=>s.verified&&!s.warmup).flatMap(s=>s.observations||[])].some(o=>o.metric==='native.code_size'||o.metric==='native.code_image'))));
  if(!all.length)continue;
  const measured=all.filter(t=>t.scenario===scenario&&t.block>=0);
  const failed=all.some(t=>!['ok','unsupported','disabled'].includes(t.status));
  const values=[],kinds=new Set();
  for(const t of measured.filter(t=>t.status==='ok')) {
   const observations=[...(t.observations||[]),...(t.samples||[]).filter(s=>s.verified&&!s.warmup).flatMap(s=>s.observations||[])];
   const available=name=>observations.filter(o=>o.metric===name&&o.status==='available'&&Number.isSafeInteger(o.value)&&o.value>=0).map(o=>o.value);
   if(profile==='memory'){
    const nativeWorker=observations.filter(o=>o.metric==='aot.native_worker.peak_rss');
    const children=phase==='compile'?observations.filter(o=>/^aot\.(pipeline|transpile|native_compile)\.peak_rss$/.test(o.metric)&&o.status==='available'&&Number.isSafeInteger(o.value)&&o.value>=0).map(o=>o.value):[];
    const measured=children.length?[...children,...available(metric)]:nativeWorker.length?available('aot.native_worker.peak_rss'):available(metric);
    if(measured.length)values.push(Math.max(...measured));continue
   }
   // A complete native image takes precedence over an engine's code-size estimate.
   const imageBytes=typeof t.code_image?.data==='string'?Buffer.byteLength(t.code_image.data,'base64'):null;
   const native=available('native.code_image'),reported=available('native.code_size');
   if(imageBytes!=null||native.length){values.push(imageBytes??Math.max(...native));kinds.add('native-image')}
   else if(reported.length){values.push(Math.max(...reported));kinds.add('engine-reported')}

  }
  out[statusField]=failed||kinds.size>1?'failed':values.length?'ok':measured.length?'unsupported':'not-measured';
  out[field]=out[statusField]==='ok'?(profile==='memory'?Math.max(...values):median(values)):null;
  if(profile==='code'&&out.codeStatus==='ok')out.codeKind=[...kinds][0];
 }
 return out;
}

export async function collectLatencies({directory,workloads,engines,collection,run,platform,onTiming=()=>{}}) {
 const policy=!!collection.adaptiveSampling;
 if(policy)collection={...collection,samples:5,warmup:0,launches:1,scenarioSamples:{'*':5}};
 const started=performance.now();let runnerMs=0;
 const scratch=join(directory,'capture');
 await rm(scratch,{recursive:true,force:true});await mkdir(scratch,{recursive:true});
 const suite=join(directory,'wago-suite.json');
 const scenarios=(collection.scenarios||phases.join(',')).split(',');
 if(scenarios.some(p=>!phases.includes(p)))throw Error('Latency captures support compile, instantiate, first-call and steady');
 const shared=['--archive-tools=false','--suite',suite,'--runtimes',engines.join(','),'--workers','1','--timeout',collection.timeout,'--validation-profile',collection.validationProfile||'all'];
 const execute=async(out,selected,operations,samples,profile='timing',runtimeIds=engines,launchesOverride,steadyOperations,rssOnly=false)=>{
  const adaptive=policy&&profile==='timing'&&!rssOnly;
  const runnerStarted=performance.now();
  try {await run('run',...shared.map((value,index)=>shared[index-1]==='--runtimes'?runtimeIds.join(','):value),'--timing-peak-rss='+String(profile==='timing'&&!!collection.memory),...(profile==='memory'&&collection.phaseBarriers&&!rssOnly?['--phase-barriers']:[]),'--profile',profile,...(adaptive?['--adaptive-samples']:[]),'--launches',String(launchesOverride??(rssOnly||adaptive?1:profile==='timing'?(workloads.every(w=>w.provenance?.performance)&&selected.includes('steady')?Math.max(3,collection.launches||1):collection.launches):1)),'--scenarios',selected.join(','),'--samples',String(samples),'--samples-by-scenario',JSON.stringify(Object.fromEntries(Object.entries(rssOnly?{'*':1}:profile==='timing'?collection.scenarioSamples||{}:{'*':1}).filter(([p])=>p==='*'||selected.includes(p)))),'--operations',String(operations),...(profile==='timing'&&steadyOperations!==undefined?['--steady-operations',String(steadyOperations)]:[]),'--warmup',String(rssOnly||adaptive?0:profile==='timing'?(workloads.every(w=>w.provenance?.performance)&&selected.includes('steady')?7:collection.warmup):0),'--out',out);}
  catch(error){
   // A failed trial is data only when the producer completed its sealed output.
   // Infrastructure failures or incomplete runs remain errors.
   try{await run('verify','--run',out)}catch(verificationError){throw new Error(`Capture infrastructure failure: ${error.message}; producer output incomplete: ${verificationError.message}`,{cause:error})}
   const manifest=JSON.parse(await readFile(join(out,'manifest.json')));
   if(!manifest)throw error;
  } finally {runnerMs+=performance.now()-runnerStarted;}
 };
 const load=async(out)=>{
  const bundle=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
  const order=new Map((bundle.trial_order||[]).map((id,index)=>[id,index]));
  const trials=await Promise.all((await readdir(join(out,'trials'))).filter(name=>name.endsWith('.json')).map(async name=>parseCorpusJSON(await readFile(join(out,'trials',name),'utf8'))));
  const identified=await identifyEngineFatals(trials,async path=>{
   const file=await open(join(out,path),'r');
   try{const size=(await file.stat()).size;if(size>65536)return '';return await file.readFile('utf8');}finally{await file.close();}
  });
  return identified.sort((left,right)=>(order.get(left.id)??Infinity)-(order.get(right.id)??Infinity));
 };
 try {
  const calls=workloads.every(w=>w.id.startsWith('mechanisms/'))&&scenarios.includes('steady');
  const featurePerformance=workloads.every(w=>w.provenance?.performance)&&scenarios.includes('steady');
  const ordinary=(calls||featurePerformance)?scenarios.filter(p=>p!=='steady'):scenarios;
  const timing=join(scratch,'timing');let manifest,trials=[];
  if(!policy&&ordinary.length){await execute(timing,ordinary,collection.operations,collection.samples);manifest=JSON.parse(await readFile(join(timing,'manifest.json')));trials=await load(timing);}
  if(!policy&&featurePerformance){
   const out=await collectFeatureBatches({directory:scratch,samples:collection.samples,operations:collection.operations,run:(out,operations,samples)=>execute(out,['steady'],operations,samples),load});
   const featureManifest=JSON.parse(await readFile(join(out,'manifest.json')));if(manifest&&JSON.stringify(manifest.host)!==JSON.stringify(featureManifest.host))throw Error('Feature phases changed platform');
   if(manifest&&JSON.stringify(manifest.lock.runtime_configurations)!==JSON.stringify(featureManifest.lock.runtime_configurations))throw Error('Engine identity changed during feature capture');
   manifest=featureManifest;trials.push(...await load(out));
  }
  if(!policy&&calls){
   const out=await collectCallBatches({directory:scratch,prefix:'calls',operations:callBatchOperations(workloads[0],collection),samples:collection.samples,run:(out,operations,samples)=>execute(out,['steady'],operations,samples),verify:async()=>{},load});
   const callManifest=JSON.parse(await readFile(join(out,'manifest.json')));
   if(manifest&&JSON.stringify(manifest.lock.runtime_configurations)!==JSON.stringify(callManifest.lock.runtime_configurations))throw Error('Engine identity changed during latency capture');
   manifest=callManifest;trials.push(...await load(out));
  }
  if(policy){
   const diagnostics={policy:samplePolicy,method:'same-process-stability-v1',assumption:'Ordered samples within one process; repeatability rule, no independent-launch confidence claim.',phases:[]};
   const collect=async(selected,operations,out,steadyOperations)=>{
    if(!selected.length)return;
    await execute(out,selected,operations,5,'timing',engines,1,steadyOperations);
    const next=JSON.parse(await readFile(join(out,'manifest.json')));
    if(manifest&&JSON.stringify(manifest.host)!==JSON.stringify(next.host))throw Error('Platform changed between phase captures');
    if(manifest&&JSON.stringify(manifest.lock.runtime_configurations)!==JSON.stringify(next.lock.runtime_configurations))throw Error('Engine identity changed between phase captures');
    manifest=next;const collected=await load(out);for(const trial of collected)if(trial.profile==='timing')trial.sampling={method:'same-process-stability-v1',maxSamples:collection.phaseSampleCaps?.[trial.scenario]||35};trials.push(...collected);
   };
   if(calls&&!collection.supportsSteadyOperations){
    // Migration gate for already running campaigns with old cached controllers.
    // New campaigns enable the flag after installing the controller extension.
    await collect(ordinary,collection.operations,timing);
    await collect(['steady'],callBatchOperations(workloads[0],collection),join(scratch,'calls'));
   }else{
    await collect(scenarios,collection.operations,timing,calls?callBatchOperations(workloads[0],collection):featurePerformance?collection.steadyOperations:undefined);
   }
   for(const trial of trials.filter(t=>t.profile==='timing'&&t.block>=0&&t.status==='ok')){
    const values=(trial.samples||[]).filter(s=>!s.warmup&&s.verified).map(s=>s.elapsed_ns/s.operations);
    const decision=sampleStability(values,trial.sampling?.maxSamples||35);
    if(!decision.stop)throw Error('Producer returned an incomplete adaptive sample sequence');
    diagnostics.phases.push({engine:trial.runtime_configuration,workload:trial.workload,phase:trial.scenario,...decision});
   }
   await writeFile(join(directory,'sampling.json'),JSON.stringify(diagnostics,null,2)+'\n');
  }
  if(!manifest)throw Error('No latency scenarios selected');
  if(policy&&collection.memory){
   const observations=trial=>[...(trial.observations||[]),...(trial.samples||[]).filter(sample=>sample.verified&&!sample.warmup).flatMap(sample=>sample.observations||[])];
   const rssPhases=[];
   for(const engine of engines){
    const missingRSS=scenarios.filter(phase=>{
     const measured=trials.filter(trial=>trial.profile==='timing'&&trial.runtime_configuration===engine&&trial.scenario===phase&&trial.block>=0&&trial.status==='ok');
     return measured.length>0&&!measured.some(trial=>{
      const all=observations(trial),native=all.filter(o=>o.metric==='aot.native_worker.peak_rss');
      const candidates=phase==='compile'&&all.some(o=>/^aot\.(pipeline|transpile|native_compile)\.peak_rss$/.test(o.metric))?all.filter(o=>/^aot\.(pipeline|transpile|native_compile)\.peak_rss$/.test(o.metric)):native.length?native:all.filter(o=>o.metric==='process.peak_rss');
      return candidates.some(o=>o.status==='available'&&Number.isFinite(o.value)&&o.value>=0);
     });
    });
    if(!missingRSS.length)continue;
    // Reap an actual transpiled native worker in a memory-only legacy pass.
    // Other adapters retain the established deterministic wait4 timing pass.
    const profile=engine==='wasm2go'?'memory':'timing';
    const out=join(scratch,'rss-'+engine);await execute(out,missingRSS,1,1,profile,[engine],1,undefined,true);
    const rssManifest=JSON.parse(await readFile(join(out,'manifest.json')));
    if(JSON.stringify(manifest.lock.runtime_configurations.filter(c=>c.id===engine))!==JSON.stringify(rssManifest.lock.runtime_configurations))throw Error('Engine identity changed during deterministic RSS capture');
    for(const trial of await load(out)){
     if(trial.profile!==profile||trial.block<0)continue;
     trials.push({...trial,profile:'memory',samples:[],observations:observations(trial).filter(o=>o.metric==='process.peak_rss'||/^aot\.(pipeline|transpile|native_compile|native_worker)\.peak_rss$/.test(o.metric))});
    }
    rssPhases.push({engine,phases:missingRSS,scope:engine==='wasm2go'?'native_worker_process_lifetime':'adapter_process_lifetime'});
   }
   if(rssPhases.length)await writeFile(join(directory,'rss-capture.json'),JSON.stringify({method:'single-deterministic-process-per-phase',collector:'wait4_rusage',runtimes:rssPhases,samplesPerPhase:1,warmup:0,latencySamplesPublished:false},null,2)+'\n');
  }
  for(const [profile,selected] of [['code',['compile']]]) {
   if(!collection[profile])continue;
   const hasCode=engine=>workloads.every(w=>trials.some(t=>t.runtime_configuration===engine&&t.workload===w.id&&t.scenario==='compile'&&t.status==='ok'&&[...(t.observations||[]),...(t.samples||[]).filter(s=>s.verified&&!s.warmup).flatMap(s=>s.observations||[])].some(o=>['native.code_size','native.code_image'].includes(o.metric)&&o.status==='available'&&Number.isSafeInteger(o.value)&&o.value>=0)));
   const supported=engines.filter(engine=>{if(hasCode(engine))return false;const cfg=manifest.lock.runtime_configurations.find(c=>c.id===engine);const caps=cfg?.description?.capabilities;return !(/interpreter/.test(cfg?.description?.backend||'')||caps?.can_code_profile===false||caps?.can_measure_native_code_size===false&&caps?.can_export_native_code===false)});
   const unavailable=engines.filter(engine=>!supported.includes(engine)&&!hasCode(engine));
   for(const engine of unavailable)for(const workload of workloads)trials.push({runtime_configuration:engine,workload:workload.id,profile,scenario:'compile',block:0,status:'unsupported',samples:[]});
   if(!supported.length)continue;
   const out=join(scratch,profile);await execute(out,selected,1,1,profile,supported);
   const resourceManifest=JSON.parse(await readFile(join(out,'manifest.json')));
   if(JSON.stringify(manifest.lock.runtime_configurations.filter(c=>supported.includes(c.id)))!==JSON.stringify(resourceManifest.lock.runtime_configurations))throw Error('Engine identity changed during resource capture');
   trials.push(...await load(out));
  }
  if(process.env.WASMBENCH_WAGO_REVISION){const cfg=manifest.lock.runtime_configurations.find(c=>c.id==='wago');if(cfg&&!cfg.description?.runtime_version?.startsWith(process.env.WASMBENCH_WAGO_REVISION+'/'))throw Error('Measured Wago revision differs from the pinned release');}
  // Keep concise skip/error reasons after deleting heavyweight producer output.
  // These are operational notes, separate from the published measurement schema.
  const failureNotes=trials.filter(trial=>trial.profile==='timing'&&trial.status!=='ok').map(trial=>({engine:trial.runtime_configuration,workload:trial.workload,phase:trial.scenario,status:trial.status,reason:String(trial.reason||trial.error||'Producer did not provide a reason').slice(0,4096)}));
  const failureFile=join(directory,'failures.json');
  if(failureNotes.length)await writeFile(failureFile,JSON.stringify(failureNotes,null,2)+'\n');
  else await rm(failureFile,{force:true});
  const capture=summarizeLatencies({manifest,trials,workloads,engines,scenarios});
  if(platform)capture.platform=platform;
  return capture;
 } finally {await rm(scratch,{recursive:true,force:true});const totalMs=performance.now()-started;onTiming({runnerMs,captureMs:totalMs-runnerMs,totalMs});}
}
