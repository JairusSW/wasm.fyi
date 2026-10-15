import {featureScenarios} from './lib/feature-scenario-policy.mjs';
import {rebuildWazeroSampling} from './lib/wazero-sampling.mjs';
import {featureRepairPhases} from './lib/feature-repair-phases.mjs';
// Latest-only, source-bound compatibility followed by feature performance.
import {readFile,writeFile,mkdir,readdir,stat,cp} from 'node:fs/promises';
import {join,resolve,basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {featureCampaignPlatform,featureInputIdentity,featureLedgerKey} from './lib/feature-campaign-identity.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {digest} from './lib/wasmbench.mjs';
import {workloadContract} from './lib/workload-contract.mjs';
import {collectLatencies,latencyCollection} from './lib/latency-capture.mjs';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
import {runBenchmarkProcess,runCommand} from './lib/benchmark-process.mjs';
import {sharedDeviceSliceMs} from './lib/shared-device-slice.mjs';
import {historyWorkloadFailure} from './lib/history-workload-failure.mjs';
import {ensureV8BindingPolicy} from './lib/v8-binding-policy.mjs';
import {historyIntegrationFailure} from './lib/history-completion-audit.mjs';
const [campaignArg,rootArg,inputsArg,bindingsArg]=process.argv.slice(2);
if(!campaignArg||!rootArg||!inputsArg)throw Error('Usage: latest-feature-campaign CAMPAIGN FEATURE_ROOT INPUTS [BINDINGS_JSON]');
const campaign=resolve(campaignArg),root=resolve(rootArg),inputs=resolve(inputsArg);
if(process.platform==='darwin'&&process.env.WASMBENCH_SHARED_DEVICE_RESERVED!=='1'){
 // Match the history worker's lock order. The reserved inner worker acquires
 // project locks per case, so a device handoff never leaves this lock held.
 await runCommand('python3',[fileURLToPath(new URL('./shared-device-run.py',import.meta.url)),'--repeat-slices','--','env','WASMBENCH_SHARED_DEVICE_RESERVED=1',process.execPath,fileURLToPath(import.meta.url),...process.argv.slice(2)],{cwd:campaign,env:process.env});
 process.exit(0);
}
await mkdir(root,{recursive:true});
// Serialize ledger writers before reading any cached state. Measurement leases remain per case.
const writerAbort=new AbortController();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>writerAbort.abort());
const releaseWriter=await acquireMeasurementLock(join(root,'ledger-writer-lock'),writerAbort.signal);
try {
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const frozen=await readJSON(join(campaign,'source-plan.json'));
const template=await readJSON(join(campaign,'collection-template.json'));
const latest=frozen.pins.filter(p=>p.targetWeek===frozen.anchor&&['planned','reused'].includes(p.status));
const selectedEngines=(process.env.WASMFYI_FEATURE_ENGINES||'').split(',').filter(Boolean);
for(const engine of selectedEngines)if(!latest.some(pin=>pin.configurations.includes(engine)))throw Error('Unknown latest feature engine '+engine);
let bindings=bindingsArg?await readJSON(resolve(bindingsArg)):[];
if(!bindingsArg){
 const plans=[];
 async function scan(path,depth=0){if(depth>4)return;for(const e of await readdir(path,{withFileTypes:true}).catch(()=>[])){
  if(e.name==='plan.json'){try{const p=await readJSON(join(path,e.name));if(p.jobs)plans.push(p)}catch{}}
  else if(e.isDirectory()&&!['scratch','harness','sources','sdk-builds','captures','node_modules','target','data'].includes(e.name))await scan(join(path,e.name),depth+1);
 }}
 for(const name of ['engine-builds','go-builds','libwasm-builds','builds'])await scan(join(campaign,name));
 for(const pin of latest)for(const engine of pin.configurations){
  const match=plans.flatMap(plan=>plan.jobs.map(job=>({engine:job.engine,job,plan}))).find(b=>b.engine===engine&&b.job.source?.revision===pin.revision&&b.job.source?.asOf===pin.targetWeek);
  if(match)bindings.push(match);
 }
}
const suites={};
for(const kind of ['compatibility','performance','compile','lifecycle']){
 suites[kind]=await readJSON(join(inputs,kind+'.json'));
 for(const w of suites[kind]){
  if(!w.id.startsWith('features/'))throw Error('Non-feature workload in feature inputs');
  w.artifact=resolve(inputs,w.artifact);if(w.source&&!w.source.startsWith('/'))w.source=resolve(inputs,w.source);
  if(digest(await readFile(w.artifact))!==w.sha256)throw Error('Feature artifact identity differs: '+w.id);
  w.artifactName ||=basename(w.artifact);w.bytes=(await stat(w.artifact)).size;
 }
}
const inputIdentity=featureInputIdentity(suites);
const ledgerPath=join(root,'ledger.json');const ledger=await readJSON(ledgerPath).catch(()=>({items:{},completedEngines:[]}));
const state={status:'running',started:new Date().toISOString(),updated:'',current:null,completed:0,total:latest.reduce((n,p)=>n+p.configurations.filter(engine=>!selectedEngines.length||selectedEngines.includes(engine)).length,0),errors:[],inputIdentity,compatibilityWorkloads:suites.compatibility.length,performanceWorkloads:suites.performance.length+suites.compile.length+suites.lifecycle.length};
const save=async()=>{state.updated=new Date().toISOString();await atomicJSON(join(root,'status.json'),state);await atomicJSON(ledgerPath,ledger)};
const deadline=performance.now()+(process.platform==='darwin'?await sharedDeviceSliceMs(campaign):Infinity);
const platform=featureCampaignPlatform(template);
const hostKey=digest(Buffer.from(JSON.stringify(platform)));
const abort=writerAbort;
async function acquireFeatureProjectLock(){
 if(process.env.WASMBENCH_PROJECT_RESERVED==='1')return async()=>{};
 const bounded=process.platform==='darwin'&&process.env.WASMBENCH_SHARED_DEVICE_RESERVED==='1';
 const signal=bounded?AbortSignal.any([abort.signal,AbortSignal.timeout(2000)]):abort.signal;
 try{return await acquireMeasurementLock(join(campaign,'measurement-lock'),signal)}
 catch(error){
  if(bounded&&!abort.signal.aborted&&['TimeoutError','AbortError'].includes(error.name)){
   state.status='waiting-host-lock';await save();
   throw Object.assign(Error('Project occupied; release the shared device before retrying'),{code:'FEATURE_PROJECT_OCCUPIED'});
  }
  throw error;
 }
}
await save();
const repairEngines=(process.env.WASMFYI_FEATURE_REPAIR_ENGINES||'').split(',').filter(Boolean);
const repairWorkloads=JSON.parse(process.env.WASMFYI_FEATURE_REPAIR_WORKLOADS||'[]');
campaignLoop: for(const pin of latest)for(const engine of pin.configurations){
 if(selectedEngines.length&&!selectedEngines.includes(engine))continue;
 if(repairEngines.length&&!repairEngines.includes(engine))continue;
 const binding=bindings.find(b=>b.engine===engine&&b.job?.source?.revision===pin.revision&&b.job?.source?.asOf===pin.targetWeek);
 if(!binding){state.errors.push({engine,kind:'adapter-binding-missing',revision:pin.revision});state.completed++;await save();continue}
 let {job,plan}=binding;
 try{if(engine==='v8'){for(const name of await readdir(join(campaign,'sdk-builds')).catch(()=>[])){const dir=join(campaign,'sdk-builds',name),receipt=await readJSON(join(dir,'v8-build.json')).catch(()=>null);if(receipt?.pin?.revision===pin.revision){const release=await acquireFeatureProjectLock();let upgraded;try{upgraded=await ensureV8BindingPolicy(campaign,dir,receipt,{reserved:true,env:{...template.env,...plan.env,...job.env},featureJspi:true})}finally{await release()};job={...job,controller:upgraded.controller,harness:upgraded.root,env:{...job.env,...upgraded.env},backend:'turboshaft'};break;}}}}catch(error){if(error.code==='FEATURE_PROJECT_OCCUPIED')throw error;state.errors.push({engine,kind:'adapter-binding-migration',error:String(error),source:job.source});await atomicJSON(join(root,'binding-repairs',engine+'.json'),{status:'repair-pending',source:job.source,error:String(error)});state.completed++;await save();continue;}
 const controller=job.controller||plan.controller,harness=job.harness||plan.harness;
 if(repairEngines.includes(engine)&&['wazero','wazero-interpreter'].includes(engine)){
  const release=await acquireFeatureProjectLock();
  try{
   const buildEnv={...process.env,...template.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
   for(const k of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete buildEnv[k];
   await rebuildWazeroSampling({root:harness,env:buildEnv,run:(program,args,options)=>runCommand(program,args,{...options,log:join(root,'wazero-lifecycle-build.log')})});
  }catch(error){state.errors.push({engine,kind:'adapter-binding-migration',error:String(error)});state.completed++;await save();continue}finally{await release()}
 }

 if(!await stat(controller).catch(()=>null)||!await stat(harness).catch(()=>null)){state.errors.push({engine,kind:'adapter-binding-path-missing'});state.completed++;await save();continue}
 const env={...process.env,...template.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',GOMAXPROCS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1',WASMBENCH_SINGLE_CORE:'1',WASMBENCH_RECORD_FAILURES:'1',WASMBENCH_CODE_SIZE_ONLY:'1',WASMBENCH_SOURCE_JSON:JSON.stringify(job.source)};
 if(engine==='chicory'){const simd=await readJSON(join(root,'chicory-simd-repair.json')).catch(()=>null);if(simd?.status==='adapter-rebuilt'&&simd.sourceRevision===job.source.revision)env.JAVA_TOOL_OPTIONS=[env.JAVA_TOOL_OPTIONS||'','--add-modules=jdk.incubator.vector'].filter(Boolean).join(' ');}
 let held=false;
 for(const kind of ['compatibility','performance','compile','lifecycle']){
  if(held)break;
  for(const workload of suites[kind]){
   if(abort.signal.aborted||performance.now()+360000>deadline){state.status=abort.signal.aborted?'paused':'yielded';await save();process.exitCode=abort.signal.aborted?130:76;break}
   if(repairEngines.length&&repairWorkloads.length&&!repairWorkloads.includes(workload.id))continue;
   const key=featureLedgerKey(hostKey,engine,job.source,kind,workload,inputIdentity);
   const prior=ledger.items[key];
   // Adapter failures are retried only by an explicit repair owner.
   if(!repairEngines.length&&prior?.status==='repair-pending'){if(prior.failure)state.errors.push(prior.failure);held=true;break;}
   // Explicit source-backed Wasmi proposal activation can repair old admission
   // outcomes too. It never selects unrelated GC/EH or an already OK phase.
   const repairPhases=featureRepairPhases({engine,workload,prior,repairEngines,repairWorkloads,wasmiProposals:process.env.WASMFYI_FEATURE_REPAIR_WASMI_PROPOSALS==='1'});
   if(repairEngines.length&&prior&&!repairPhases.length)continue;
   if(!repairPhases.length&&ledger.items[key]?.status==='completed'){if(ledger.items[key].failure)state.errors.push(ledger.items[key].failure);continue;}
   state.current={engine,stage:kind,workload:workload.id,revision:job.source.revision};await save();
   const release=await acquireFeatureProjectLock();
   const scratch=join(root,'scratch',key);if(repairPhases.length&&await stat(scratch).catch(()=>null))await cp(scratch,scratch+'.before-repair-'+Date.now(),{recursive:true});await mkdir(scratch,{recursive:true});
   const producerDirectory=join(root,'compatibility',engine,key,repairPhases.length?'producer-repair-'+Date.now():'producer');await atomicJSON(join(scratch,'wago-suite.json'),[workload]);
   process.env.WASMBENCH_SOURCE_JSON=env.WASMBENCH_SOURCE_JSON;
   const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(300000)]);
   const scenarios=featureScenarios(kind,workload,repairPhases);
   const collection=kind==='compatibility'?{scenarios,timeout:'5m',launches:1,samples:1,operations:1,warmup:0,memory:false,code:false,supportsSteadyOperations:true}:latencyCollection({scenarios,timeout:'5m',launches:1,samples:5,operations:1,warmup:0,phaseSampleCaps:{compile:10,instantiate:10,'first-call':25,steady:25},supportsSteadyOperations:true});
   let capture,note;
   try{
    if(job.unavailableReason)capture={capturedAt:new Date().toISOString(),source:job.source,platform:{...platform},results:scenarios.split(',').map(phase=>({workload:workload.id,wasm:workload.artifactName,artifactSha256:workload.sha256,contractSha256:workloadContract(workload),engine,version:job.source.revision,backend:job.backend||engine,phase,timingSamples:0,latencyStatus:'unsupported',latencyNs:null,memoryStatus:'unsupported',peakRssBytes:null,codeStatus:'unsupported',codeBytes:null,codeKind:null}))};
    else capture=await collectLatencies({directory:scratch,workloads:[workload],engines:[engine],collection,run:async(...args)=>{
     try{return await runBenchmarkProcess(process.platform==='linux'?'taskset':controller,process.platform==='linux'?['-c',String(template.cpu??2),controller,...args]:args,{cwd:harness,env,signal});}
     finally{if(kind==='compatibility'&&args.includes('--out')){const out=args[args.indexOf('--out')+1];if(await stat(join(out,'manifest.json')).catch(()=>null))await cp(out,producerDirectory,{recursive:true,force:true});}}
    }});
    if(kind==='compatibility'){
     for(const row of capture.results)if(row.latencyStatus==='ok')row.sampling={method:'feature-compatibility-v1',groupSize:1,maxSamples:1,warmup:0,retainedStart:0,stopReason:'fixed-sample'};
    }
    const failures=await readJSON(join(scratch,'failures.json')).catch(()=>[]);
    if(capture.results.some(row=>row.latencyStatus==='failed'))note={source:job.source,engine,workload:workload.id,kind:'failed-trials',failures,reason:failures.map(f=>f.reason).join('; '),phases:capture.results.filter(r=>r.latencyStatus==='failed').map(r=>r.phase)};
   }catch(error){({capture,note}=historyWorkloadFailure({workload,job,platform,error,signal}));capture.results=capture.results.filter(row=>scenarios.split(',').includes(row.phase));}
   finally{await release()}
   if(repairPhases.length)capture.results=capture.results.filter(row=>repairPhases.includes(row.phase));
   capture.platform.memoryBytes=platform.memoryBytes;
   if(template.platformSpecs?.cores)capture.platform.cores=template.platformSpecs.cores;
   const name='feature-'+(repairPhases.length?'repair-'+Date.now()+'-':'')+(kind==='compatibility'?'compat':'perf')+'-'+engine+'-'+key+'.json';
   await atomicJSON(join(root,'captures',name),capture);await atomicJSON(join(campaign,'captures',name),capture);
   if(note){await atomicJSON(join(root,'failure-notes',name),note);await atomicJSON(join(campaign,'failure-notes',name),note);state.errors.push({...state.current,...note});}
   const integration=note&&historyIntegrationFailure(note);
   ledger.items[key]={...(kind==='compatibility'?{compatibilityScenarioPolicy:repairPhases.length?'retained-original-repair-phases':'scope-aware-v2'}:{}),status:integration?'repair-pending':'completed',engine,stage:kind,workload:workload.id,source:job.source,capture:name,artifactSha256:workload.sha256,contractSha256:workloadContract(workload),outcomes:repairPhases.length?prior.outcomes.map(([phase,status])=>[phase,capture.results.find(r=>r.phase===phase)?.latencyStatus||status]):capture.results.map(r=>[r.phase,r.latencyStatus]),...(repairPhases.length?{repairOf:prior.capture,repairPhases}:{}),...(note?{failure:note}:{}),finished:new Date().toISOString()};await save();
   if(integration){held=true;break}
  }
  if(process.exitCode)break;
 }
 if(process.exitCode)break campaignLoop;
 const fullCoverage=Object.entries(suites).every(([kind,workloads])=>workloads.every(w=>{const key=featureLedgerKey(hostKey,engine,job.source,kind,w,inputIdentity);return ledger.items[key]?.status==='completed'}));
 if(!held&&fullCoverage)ledger.completedEngines=[...new Set([...ledger.completedEngines,engine+'|'+pin.revision+'|'+inputIdentity])];state.completed++;await save();
}
if(!process.exitCode){state.current=null;state.status=state.errors.some(e=>historyIntegrationFailure(e)||String(e.kind).startsWith('adapter-binding'))?'repair-pending':state.errors.length?'completed-with-errors':'completed';await save()}

} catch(error) {
 if(error.code==='FEATURE_PROJECT_OCCUPIED')process.exitCode=75;
 else throw error;
} finally { await releaseWriter(); }
