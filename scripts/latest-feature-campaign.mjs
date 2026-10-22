import {retainedFeatureGuestFatal} from './lib/feature-guest-fatal.mjs';
import {upgradeWizardFeatureCommand} from './lib/wizard-feature-policy.mjs';
import {featureScenarios} from './lib/feature-scenario-policy.mjs';
import {chicoryVectorOptions} from './lib/chicory-simd.mjs';
import {rebuildWazeroSampling,assertWazeroInterruptsDisabled} from './lib/wazero-sampling.mjs';
import {applyWasmEdgeFeaturePolicy} from './lib/wasmedge-feature-policy.mjs';
import {applyWasmerCraneliftAdapter} from './lib/wasmer-cranelift-adapter.mjs';
import {featureRepairPhases} from './lib/feature-repair-phases.mjs';
import {upgradeFeatureHostProfileController} from './lib/feature-host-profile-policy.mjs';
// Latest-only, source-bound compatibility followed by feature performance.
import {readFile,writeFile,mkdir,readdir,stat,cp} from 'node:fs/promises';
import {join,resolve,basename,dirname} from 'node:path';
import {featureCampaignPlatform,featureInputIdentity,featureLedgerKey} from './lib/feature-campaign-identity.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {digest} from './lib/wasmbench.mjs';
import {workloadContract} from './lib/workload-contract.mjs';
import {collectLatencies,latencyCollection} from './lib/latency-capture.mjs';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
import {runBenchmarkProcess,runCommand} from './lib/benchmark-process.mjs';
import {historyWorkloadFailure} from './lib/history-workload-failure.mjs';
import {ensureV8BindingPolicy} from './lib/v8-binding-policy.mjs';
import {historyIntegrationFailure} from './lib/history-completion-audit.mjs';
import {classifyFeatureRuntimeRejection,classifyFeatureCapture,featureFailureRecords} from './lib/feature-unsupported.mjs';
import {latestFeaturePins} from './lib/latest-feature-pins.mjs';
import {v8FlagsForWorkload} from './lib/v8-feature-flags.mjs';
import {applyWavmFeaturePolicy} from './lib/wavm-feature-policy.mjs';
import {buildWavmSDK} from './lib/wavm-sdk.mjs';
import {applyWasm3FeaturePolicy,wasm3FeatureCMakeFlags} from './lib/wasm3-feature-policy.mjs';
import {terminalFeatureRuntimeFailure} from './lib/feature-terminal-failure.mjs';
import {applyWasm2GoFeaturePolicy} from './lib/wasm2go-feature-policy.mjs';
import {featureFailureForOutcomes,normalizeRepairedFeatureItem,repairedFeatureOutcomes} from './lib/feature-repair-ledger.mjs';
import {featureBindingForWorkload,featureBindingsForEngine,featureProfileForBinding,missingFeatureBindingProfiles} from './lib/feature-binding-policy.mjs';
const [campaignArg,rootArg,inputsArg,bindingsArg]=process.argv.slice(2);
if(!campaignArg||!rootArg||!inputsArg)throw Error('Usage: latest-feature-campaign CAMPAIGN FEATURE_ROOT INPUTS [BINDINGS_JSON]');
const campaign=resolve(campaignArg),root=resolve(rootArg),inputs=resolve(inputsArg);
await mkdir(root,{recursive:true});
// Serialize ledger writers before reading any cached state. Measurement leases remain per case.
const writerAbort=new AbortController();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>writerAbort.abort());
const releaseWriter=await acquireMeasurementLock(join(root,'ledger-writer-lock'),writerAbort.signal);
try {
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const frozen=await readJSON(join(campaign,'source-plan.json'));
const template=await readJSON(join(campaign,'collection-template.json'));
// Latest feature qualification can intentionally advance ahead of the frozen
// historical calendar. Keep that input explicit so history remains immutable.
const featurePins=process.env.WASMFYI_FEATURE_PINS_FILE
 ?(await readJSON(resolve(process.env.WASMFYI_FEATURE_PINS_FILE))).pins
 :frozen.pins;
if(!Array.isArray(featurePins))throw Error('Latest feature pins file must contain a pins array');
const latest=latestFeaturePins(featurePins);
const selectedEngines=(process.env.WASMFYI_FEATURE_ENGINES||'').split(',').filter(Boolean);
for(const engine of selectedEngines)if(!latest.some(pin=>pin.configurations.includes(engine)))throw Error('Unknown latest feature engine '+engine);
let bindings=bindingsArg?await readJSON(resolve(bindingsArg)):[];
if(!bindingsArg){
 const plans=[];
 async function scan(path,depth=0){if(depth>4)return;for(const e of await readdir(path,{withFileTypes:true}).catch(()=>[])){
  if(e.name==='plan.json'){try{const p=await readJSON(join(path,e.name));if(p.jobs)plans.push(p)}catch{}}
  else if(e.isDirectory()&&!['scratch','harness','sources','sdk-builds','captures','node_modules','target','data'].includes(e.name))await scan(join(path,e.name),depth+1);
 }}
 for(const name of ['sdk-builds','engine-builds','go-builds','libwasm-builds','builds'])await scan(join(campaign,name));
 const discovered=plans.flatMap(plan=>plan.jobs.map(job=>({engine:job.engine,job,plan})));
 for(const pin of latest)for(const engine of pin.configurations){
  bindings.push(...discovered.filter(b=>b.engine===engine&&b.job.source?.revision===pin.revision&&b.job.source?.asOf===pin.targetWeek));
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
const deadline=Infinity;
const platform=featureCampaignPlatform(template);
const hostKey=digest(Buffer.from(JSON.stringify(platform)));
const abort=writerAbort;
async function acquireFeatureProjectLock(){
 if(process.env.WASMBENCH_PROJECT_RESERVED==='1')return async()=>{};
 return await acquireMeasurementLock(join(campaign,'measurement-lock'),abort.signal);
}
await save();
const repairEngines=(process.env.WASMFYI_FEATURE_REPAIR_ENGINES||'').split(',').filter(Boolean);
const repairPolicy=process.env.WASMFYI_FEATURE_REPAIR_POLICY||'declared-feature-repair-v1';
const repairWorkloads=process.env.WASMFYI_FEATURE_REPAIR_WORKLOADS_FILE
 ?await readJSON(resolve(process.env.WASMFYI_FEATURE_REPAIR_WORKLOADS_FILE))
 :JSON.parse(process.env.WASMFYI_FEATURE_REPAIR_WORKLOADS||'[]');
const upgradedHostProfileControllers=new Set();
campaignLoop: for(const pin of latest)for(const engine of pin.configurations){
 if(selectedEngines.length&&!selectedEngines.includes(engine))continue;
 if(repairEngines.length&&!repairEngines.includes(engine))continue;
 const engineBindings=featureBindingsForEngine(bindings,engine,pin);
 const selectedWorkloads=Object.values(suites).flat().filter(workload=>!repairWorkloads.length||repairWorkloads.includes(workload.id));
 const missingProfiles=missingFeatureBindingProfiles(engineBindings,engine,selectedWorkloads);
 if(missingProfiles.length){state.errors.push({engine,kind:'adapter-binding-missing',revision:pin.revision,featureProfiles:missingProfiles});state.completed++;await save();continue}
 const binding=featureBindingForWorkload(engineBindings,engine,null);
 if(!binding){state.errors.push({engine,kind:'adapter-binding-missing',revision:pin.revision});state.completed++;await save();continue}
 let {job,plan}=binding;
 try{if(engine==='v8'){for(const name of await readdir(join(campaign,'sdk-builds')).catch(()=>[])){const dir=join(campaign,'sdk-builds',name),receipt=await readJSON(join(dir,'v8-build.json')).catch(()=>null);if(receipt?.pin?.revision===pin.revision){const release=await acquireFeatureProjectLock();let upgraded;try{upgraded=await ensureV8BindingPolicy(campaign,dir,receipt,{reserved:true,env:{...template.env,...plan.env,...job.env},featureJspi:true})}finally{await release()};job={...job,controller:upgraded.controller,harness:upgraded.root,env:{...job.env,...upgraded.env},backend:'turboshaft'};break;}}}}catch(error){if(error.code==='FEATURE_PROJECT_OCCUPIED')throw error;state.errors.push({engine,kind:'adapter-binding-migration',error:String(error),source:job.source});await atomicJSON(join(root,'binding-repairs',engine+'.json'),{status:'repair-pending',source:job.source,error:String(error)});state.completed++;await save();continue;}
 const controller=job.controller||plan.controller,harness=job.harness||plan.harness;
 if(engine.startsWith('wizard-')){
  const release=await acquireFeatureProjectLock();
  try{await upgradeWizardFeatureCommand(harness,engine,job.source.revision)}
  catch(error){state.errors.push({engine,kind:'adapter-binding-migration',error:String(error),source:job.source});state.completed++;await save();continue}
  finally{await release()}
 }

 let bindingMigrationFailed=false;
 for(const candidate of engineBindings){
  const candidateJob=candidate.job,candidatePlan=candidate.plan,candidateController=candidateJob.controller||candidatePlan.controller,candidateHarness=candidateJob.harness||candidatePlan.harness;
  if(candidateJob.unavailableReason||upgradedHostProfileControllers.has(candidateController))continue;
  const release=await acquireFeatureProjectLock();
  try{
   const buildEnv={...process.env,...template.env,...candidatePlan.env,...candidateJob.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
   for(const k of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete buildEnv[k];
   await upgradeFeatureHostProfileController({root:candidateHarness,controller:candidateController,env:buildEnv});
   upgradedHostProfileControllers.add(candidateController);
  }catch(error){state.errors.push({engine,kind:'adapter-binding-migration',error:String(error),source:candidateJob.source});await atomicJSON(join(root,'binding-repairs',engine+'.json'),{status:'repair-pending',source:candidateJob.source,error:String(error)});state.completed++;await save();bindingMigrationFailed=true;break}finally{await release()}
 }
 if(bindingMigrationFailed)continue;
 if(['wazero','wazero-interpreter'].includes(engine))assertWazeroInterruptsDisabled(await readFile(join(harness,'adapters/wazero/main.go'),'utf8'));
 if(repairEngines.includes(engine)&&['wazero','wazero-interpreter'].includes(engine)){
  const release=await acquireFeatureProjectLock();
  try{
   const buildEnv={...process.env,...template.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
   for(const k of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete buildEnv[k];
   await rebuildWazeroSampling({root:harness,env:buildEnv,run:(program,args,options)=>runCommand(program,args,{...options,log:join(root,'wazero-lifecycle-build.log')})});
  }catch(error){state.errors.push({engine,kind:'adapter-binding-migration',error:String(error)});state.completed++;await save();continue}finally{await release()}
 }
 if(repairEngines.includes(engine)&&engine==='wasm3'){
  const release=await acquireFeatureProjectLock();
  try{
   const buildEnv={...process.env,...template.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
   for(const k of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete buildEnv[k];
   const sdk=buildEnv.WASMBENCH_WASM3_SDK;if(!sdk)throw Error('wasm3 SDK path is missing from the frozen build binding');
   const buildDirectory=dirname(dirname(harness)),source=join(buildDirectory,'sources/wasm3'),sdkTarget=join(buildDirectory,'wasm3-build');
   await runCommand('cmake',['-S',source,'-B',sdkTarget,'-DCMAKE_BUILD_TYPE=Release','-DBUILD_WASI=none',...wasm3FeatureCMakeFlags],{cwd:harness,env:buildEnv,log:join(root,'wasm3-feature-policy-build.log')});
   await runCommand('cmake',['--build',sdkTarget,'--target','m3','--parallel'],{cwd:harness,env:buildEnv,log:join(root,'wasm3-feature-policy-build.log')});
   await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
   for(const name of await readdir(join(source,'source')))if(name.endsWith('.h'))await cp(join(source,'source',name),join(sdk,'include',name));
   await cp(join(sdkTarget,'source/libm3.a'),join(sdk,'lib/libm3.a'));
   await applyWasm3FeaturePolicy(harness);
   const target=join(harness,'adapters/native/target/wasm3');
   await runCommand('cargo',['build','--release','--locked','--no-default-features','--features','wasm3','--target-dir',target,'--manifest-path',join(harness,'adapters/native/Cargo.toml')],{cwd:harness,env:buildEnv,log:join(root,'wasm3-feature-policy-build.log')});
   await cp(join(target,'release/adapter-native'),join(harness,'bin/adapter-wasm3'));
  }catch(error){state.errors.push({engine,kind:'adapter-binding-migration',error:String(error)});state.completed++;await save();continue}finally{await release()}
 }
 if(repairEngines.includes(engine)&&engine==='wasm2go'){
  const release=await acquireFeatureProjectLock();
  try{
   const buildEnv={...process.env,...template.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
   for(const k of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete buildEnv[k];
   await applyWasm2GoFeaturePolicy(harness);
   await runCommand('go',['build','-trimpath','-o',join(harness,'bin/adapter-wasm2go'),'./adapters/wasm2go'],{cwd:harness,env:buildEnv,log:join(root,'wasm2go-feature-policy-build.log')});
  }catch(error){state.errors.push({engine,kind:'adapter-binding-migration',error:String(error),source:job.source});state.completed++;await save();continue}finally{await release()}
 }
 if(repairEngines.includes(engine)&&['wasmedge','wasmedge-jit'].includes(engine)){
  const release=await acquireFeatureProjectLock();
  try{
   const buildEnv={...process.env,...template.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
   for(const k of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete buildEnv[k];
   const sdk=buildEnv.WASMBENCH_WASMEDGE_SDK;
   if(!sdk)throw Error('WasmEdge SDK path is missing from the frozen build binding');
   await applyWasmEdgeFeaturePolicy(harness,sdk,engine);
   const target=join(harness,'adapters/native/target',engine);
   await runCommand('cargo',['build','--release','--locked','--no-default-features','--features','wasmedge','--target-dir',target],{cwd:join(harness,'adapters/native'),env:buildEnv,log:join(root,engine+'-feature-policy-build.log')});
   await cp(join(target,'release/adapter-native'),join(harness,'bin','adapter-'+engine));
  }catch(error){state.errors.push({engine,kind:'adapter-binding-migration',error:String(error)});state.completed++;await save();continue}finally{await release()}
 }
 if(repairEngines.includes(engine)&&['wasmer-singlepass','wasmer-cranelift','wasmer-llvm'].includes(engine)){
  const release=await acquireFeatureProjectLock();
  try{
   const buildEnv={...process.env,...template.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
   for(const k of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete buildEnv[k];
   await applyWasmerCraneliftAdapter(harness);
   if(engine==='wasmer-cranelift')buildEnv.WASMBENCH_WASMER_COMPILER='cranelift';
   const feature=engine==='wasmer-llvm'?'wasmer_llvm':'wasmer_singlepass';
   const target=join(harness,'adapters/native/target',engine);
   await runCommand('cargo',['build','--release','--locked','--no-default-features','--features',feature,'--target-dir',target,'--manifest-path',join(harness,'adapters/native/Cargo.toml')],{cwd:harness,env:buildEnv,log:join(root,engine+'-feature-policy-build.log')});
   await cp(join(target,'release/adapter-native'),join(harness,'bin','adapter-'+engine));
  }catch(error){state.errors.push({engine,kind:'adapter-binding-migration',error:String(error)});state.completed++;await save();continue}finally{await release()}
 }
 if(repairEngines.includes(engine)&&engine==='wavm'){
  const release=await acquireFeatureProjectLock();
  try{
   const buildEnv={...process.env,...template.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
   for(const k of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete buildEnv[k];
   const buildDirectory=dirname(dirname(job.harness)),source=join(buildDirectory,'sources','wavm'),sdk=buildEnv.WASMBENCH_WAVM_SDK||join(buildDirectory,'wavm-sdk'),target=join(buildDirectory,'wavm-build');
   await applyWavmFeaturePolicy(source,job.harness);
   await buildWavmSDK({source,sdk,target,harness:job.harness,env:buildEnv,run:(program,args,options)=>runCommand(program,args,{...options,cwd:options?.cwd||job.harness,env:buildEnv,log:join(root,'wavm-feature-policy-build.log')})});
   const adapterTarget=join(job.harness,'adapters/native/target/wavm');
   await runCommand('cargo',['build','--release','--locked','--no-default-features','--features','wavm','--target-dir',adapterTarget,'--manifest-path',join(job.harness,'adapters/native/Cargo.toml')],{cwd:job.harness,env:buildEnv,log:join(root,'wavm-feature-policy-build.log')});
   await cp(join(adapterTarget,'release/adapter-native'),join(job.harness,'bin/adapter-wavm'));
  }catch(error){state.errors.push({engine,kind:'adapter-binding-migration',error:String(error)});state.completed++;await save();continue}finally{await release()}
 }

 if(!await stat(controller).catch(()=>null)||!await stat(harness).catch(()=>null)){state.errors.push({engine,kind:'adapter-binding-path-missing'});state.completed++;await save();continue}
 const env={...process.env,...template.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',GOMAXPROCS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1',WASMBENCH_SINGLE_CORE:'1',WASMBENCH_RECORD_FAILURES:'1',WASMBENCH_CODE_SIZE_ONLY:'1',WASMBENCH_SOURCE_JSON:JSON.stringify(job.source)};
 if(engine==='chicory'){
  const simd=await readJSON(join(root,'chicory-simd-repair.json')).catch(()=>null);
  const receipt=await readJSON(join(dirname(controller),'chicory-build.json')).catch(()=>null);
  env.JAVA_TOOL_OPTIONS=chicoryVectorOptions(env.JAVA_TOOL_OPTIONS,{revision:job.source.revision,receipt,repair:simd});
 }
 let held=false;
 for(const kind of ['compatibility','performance','compile','lifecycle']){
  if(held)break;
  for(const workload of suites[kind]){
   if(abort.signal.aborted||performance.now()+360000>deadline){state.status=abort.signal.aborted?'paused':'yielded';await save();process.exitCode=abort.signal.aborted?130:76;break}
   if(repairEngines.length&&repairWorkloads.length&&!repairWorkloads.includes(workload.id))continue;
   const workloadBinding=featureBindingForWorkload(engineBindings,engine,workload)||binding;
   const workloadJob=workloadBinding.job,workloadPlan=workloadBinding.plan;
   const workloadFeatureProfile=featureProfileForBinding(workloadBinding,engine);
   const workloadController=workloadJob.controller||workloadPlan.controller,workloadHarness=workloadJob.harness||workloadPlan.harness;
   const workloadEnv=workloadBinding===binding?{...env}:{...process.env,...template.env,...workloadPlan.env,...workloadJob.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',GOMAXPROCS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1',WASMBENCH_SINGLE_CORE:'1',WASMBENCH_RECORD_FAILURES:'1',WASMBENCH_CODE_SIZE_ONLY:'1',WASMBENCH_SOURCE_JSON:JSON.stringify(workloadJob.source)};
   const key=featureLedgerKey(hostKey,engine,workloadJob.source,kind,workload,inputIdentity);
   let prior=ledger.items[key];
   if(prior?.status==='completed'&&normalizeRepairedFeatureItem(prior))await save();
   // A newly audited source-bound rejection can be applied to retained raw
   // evidence without executing the workload again. Preserve the original
   // capture and failure record as the classification receipt.
   if(prior?.status==='completed'&&prior.failure&&prior.outcomes?.some(([,status])=>status==='failed')){
    const retained=await readJSON(join(root,'captures',prior.capture)).catch(()=>null);
    const disposition=retained&&classifyFeatureRuntimeRejection({source:workloadJob.source,engine,workload,capture:retained,failures:featureFailureRecords(prior.failure,{engine,workload,capture:retained})});
    const classified=disposition&&classifyFeatureCapture(retained,disposition);
    if(classified){
     const classifiedName='feature-classified-'+engine+'-'+key+'.json';
     await atomicJSON(join(root,'captures',classifiedName),classified);await atomicJSON(join(campaign,'captures',classifiedName),classified);await atomicJSON(join(root,'source-dispositions',key+'.json'),disposition);
     prior=ledger.items[key]={...prior,capture:classifiedName,outcomes:classified.results.map(row=>[row.phase,row.latencyStatus]),classifiedFrom:prior.capture,classification:disposition};delete prior.failure;await save();
    }
   }
   if(prior?.status==='repair-pending'){
    const fatal=await retainedFeatureGuestFatal({root,key,engine,workload,prior});
    if(fatal){
     const evidence=join(root,'engine-fatals',key+'.json');await atomicJSON(evidence,fatal.evidence);
     prior.failure=fatal.failure;prior.status='completed';prior.terminalRuntimeFailure=true;prior.guestFatalEvidence=evidence;await save();
    }
   }
   // Adapter failures are retried only by an explicit repair owner.
   if(!repairEngines.length&&prior?.status==='repair-pending'){
    const engineQualified=Object.values(ledger.items).some(item=>item.engine===engine&&item.outcomes?.some(([,status])=>status==='ok'));
    if(prior.failure&&terminalFeatureRuntimeFailure(prior.failure,{engineQualified})){prior.status='completed';prior.terminalRuntimeFailure=true;await save()}
    else {if(prior.failure)state.errors.push(prior.failure);held=true;break}
   }
   // Explicit source-backed Wasmi proposal activation can repair old admission
   // outcomes too. It never selects unrelated GC/EH or an already OK phase.
   const repairPhases=featureRepairPhases({engine,workload,prior,repairEngines,repairWorkloads,wasmiProposals:process.env.WASMFYI_FEATURE_REPAIR_WASMI_PROPOSALS==='1',documentedProposals:process.env.WASMFYI_FEATURE_REPAIR_DOCUMENTED_PROPOSALS==='1',retryCompleted:process.env.WASMFYI_FEATURE_REPAIR_RETRY_COMPLETED==='1',forceAll:process.env.WASMFYI_FEATURE_REPAIR_ALL==='1',repairPolicy});
   if(repairEngines.length&&prior&&!repairPhases.length){if(prior.failure)state.errors.push(prior.failure);continue;}
   if(!repairPhases.length&&ledger.items[key]?.status==='completed'){if(ledger.items[key].failure)state.errors.push(ledger.items[key].failure);continue;}
   state.current={engine,stage:kind,workload:workload.id,revision:workloadJob.source.revision,...(workloadFeatureProfile?{featureProfile:workloadFeatureProfile}:{})};await save();
   if(engine==='v8')workloadEnv.WASMBENCH_V8_FEATURE_FLAGS=v8FlagsForWorkload(workload).join(' ');
   const release=await acquireFeatureProjectLock();
   const scratch=join(root,'scratch',key);if(repairPhases.length&&await stat(scratch).catch(()=>null))await cp(scratch,scratch+'.before-repair-'+Date.now(),{recursive:true});await mkdir(scratch,{recursive:true});
   const producerDirectory=join(root,'compatibility',engine,key,repairPhases.length?'producer-repair-'+Date.now():'producer');await atomicJSON(join(scratch,'wago-suite.json'),[workload]);
   process.env.WASMBENCH_SOURCE_JSON=workloadEnv.WASMBENCH_SOURCE_JSON;
   const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(300000)]);
   const scenarios=featureScenarios(kind,workload,repairPhases);
   const collection=kind==='compatibility'?{scenarios,timeout:'5m',launches:1,samples:1,operations:1,warmup:0,memory:false,code:false,supportsSteadyOperations:true}:latencyCollection({scenarios,timeout:'5m',launches:1,samples:5,operations:1,warmup:0,phaseSampleCaps:{compile:10,instantiate:10,'first-call':25,steady:25},supportsSteadyOperations:true});
   let capture,note;
   try{
    if(workloadJob.unavailableReason)capture={capturedAt:new Date().toISOString(),source:workloadJob.source,platform:{...platform},results:scenarios.split(',').map(phase=>({workload:workload.id,wasm:workload.artifactName,artifactSha256:workload.sha256,contractSha256:workloadContract(workload),engine,version:workloadJob.source.revision,backend:workloadJob.backend||engine,phase,timingSamples:0,latencyStatus:'unsupported',latencyNs:null,memoryStatus:'unsupported',peakRssBytes:null,codeStatus:'unsupported',codeBytes:null,codeKind:null}))};
    else capture=await collectLatencies({directory:scratch,workloads:[workload],engines:[engine],collection,run:async(...args)=>{
     try{return await runBenchmarkProcess(process.platform==='linux'?'taskset':workloadController,process.platform==='linux'?['-c',String(template.cpu??2),workloadController,...args]:args,{cwd:workloadHarness,env:workloadEnv,signal});}
     finally{if(kind==='compatibility'&&args.includes('--out')){const out=args[args.indexOf('--out')+1];if(await stat(join(out,'manifest.json')).catch(()=>null))await cp(out,producerDirectory,{recursive:true,force:true});}}
    }});
    if(kind==='compatibility'){
     for(const row of capture.results)if(row.latencyStatus==='ok')row.sampling={method:'feature-compatibility-v1',groupSize:1,maxSamples:1,warmup:0,retainedStart:0,stopReason:'fixed-sample'};
    }
    const failures=await readJSON(join(scratch,'failures.json')).catch(()=>[]);
    const unsupported=classifyFeatureRuntimeRejection({source:workloadJob.source,engine,workload,capture,failures});
    if(unsupported){capture=classifyFeatureCapture(capture,unsupported);await atomicJSON(join(root,'source-dispositions',key+'.json'),unsupported)}
    if(capture.results.some(row=>row.latencyStatus==='failed'))note={source:workloadJob.source,engine,workload:workload.id,kind:'failed-trials',failures,reason:failures.map(f=>f.reason).join('; '),phases:capture.results.filter(r=>r.latencyStatus==='failed').map(r=>r.phase)};
   }catch(error){({capture,note}=historyWorkloadFailure({workload,job:workloadJob,platform,error,signal}));capture.results=capture.results.filter(row=>scenarios.split(',').includes(row.phase));}
   finally{await release()}
   if(repairPhases.length)capture.results=capture.results.filter(row=>repairPhases.includes(row.phase));
   if(workloadFeatureProfile)capture.featureProfile=workloadFeatureProfile;
   capture.platform.memoryBytes=platform.memoryBytes;
   if(template.platformSpecs?.cores)capture.platform.cores=template.platformSpecs.cores;
   const name='feature-'+(repairPhases.length?'repair-'+Date.now()+'-':'')+(kind==='compatibility'?'compat':'perf')+'-'+engine+'-'+key+'.json';
   await atomicJSON(join(root,'captures',name),capture);await atomicJSON(join(campaign,'captures',name),capture);
   if(note){await atomicJSON(join(root,'failure-notes',name),note);await atomicJSON(join(campaign,'failure-notes',name),note);state.errors.push({...state.current,...note});}
   const engineQualified=Object.values(ledger.items).some(item=>item.engine===engine&&item.outcomes?.some(([,status])=>status==='ok'));
   const integration=note&&historyIntegrationFailure(note)&&!terminalFeatureRuntimeFailure(note,{engineQualified});
   const outcomes=repairPhases.length?repairedFeatureOutcomes(prior,capture,repairPhases):capture.results.map(r=>[r.phase,r.latencyStatus]);
   const failure=featureFailureForOutcomes(prior,outcomes,note);
   const {failure:_oldFailure,...priorWithoutFailure}=prior||{};
   ledger.items[key]={...priorWithoutFailure,...(kind==='compatibility'?{compatibilityScenarioPolicy:repairPhases.length?'retained-original-repair-phases':'scope-aware-v2'}:{}),status:integration?'repair-pending':'completed',engine,stage:kind,workload:workload.id,source:workloadJob.source,...(workloadFeatureProfile?{featureProfile:workloadFeatureProfile}:{}),capture:name,artifactSha256:workload.sha256,contractSha256:workloadContract(workload),outcomes,...(repairPhases.length?{repairOf:prior.capture,repairPhases,repairPolicy}:{}),...(failure?{failure}:{}),finished:new Date().toISOString()};await save();
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
