import {ensureV8BindingPolicy} from './lib/v8-binding-policy.mjs';
import {historyWeekMatches} from './lib/history-schedule.mjs';
import {hasPinnedCommit} from './lib/history-git-cache.mjs';
import {historyCommandError} from './lib/history-command-error.mjs';
import {withHistoricalCheckoutCapacity} from './lib/history-checkout-capacity.mjs';
import {createSDKBuildBudget} from './lib/sdk-build-budget.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {qualifyHistoryStartup} from './lib/qualify-history-startup.mjs';
import {wizardArchitectureUnavailable} from './lib/wizard-sdk.mjs';
import {historyPinAllowed} from './lib/history-window.mjs';
import {reservedBuildCommand} from './lib/shared-device-build.mjs';
import {withBuildLock} from './lib/measurement-lock.mjs';
// One complete engine family, newest source target first, using the frozen corpus.
import {readFile,writeFile,mkdir,stat,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {openSync,closeSync,fstatSync} from 'node:fs';
import {copyHistoricalHarness,buildHistoricalBinding,restoreHistoricalHarnessSources} from './lib/historical-binding.mjs';
import {command} from './lib/wasmbench.mjs';
import {readCache,atomicJSON} from './lib/benchmark-plan.mjs';
import {historyBuildDirectory} from './lib/history-build-cache.mjs';
import {pruneRustIntermediates} from './lib/prune-build-cache.mjs';
import {wasmedgeJITUnavailable} from './lib/wasmedge-sdk.mjs';
import {wamrArchitectureUnavailable} from './lib/wamr-sdk.mjs';
import {completedHistoryJob} from './lib/history-job-result.mjs';
import {needsHistoricalSourceBuild} from './lib/history-source-build.mjs';
const [rootArg,baseArg,engine]=process.argv.slice(2),root=resolve(rootArg),base=resolve(baseArg);
if(!engine)throw Error('Engine family required');
const prepareOnly=process.argv.includes('--prepare-only');
const selectedRefs=new Set(process.argv.slice(5).filter(ref=>ref!=='--prepare-only'));
const plan=JSON.parse(await readFile(join(root,'source-plan.json'))),template=JSON.parse(await readFile(join(root,'collection-template.json')));
for(const ref of selectedRefs)if(!plan.pins.some(p=>p.engine===engine&&p.status==='planned'&&(p.tag||p.revision)===ref))throw Error('Unknown supplemental source target '+ref);
if(template.collection.samples<1)throw Error('Performance history requires at least one sample');
const env={...process.env,...template.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',...(template.env?.WASMFYI_BUILD_JOBS?{CARGO_BUILD_JOBS:template.env.WASMFYI_BUILD_JOBS,GOMAXPROCS:template.env.WASMFYI_BUILD_JOBS}:{})};
const statusPath=join(root,engine+(prepareOnly?'-prepare':selectedRefs.size?'-supplement':'')+'-history-status.json');
const status=await readFile(statusPath,'utf8').then(JSON.parse,()=>({started:new Date().toISOString(),completed:[],errors:[]}));
async function retainPreparedConfiguration(configuration) {
 if(!prepareOnly)return;
 const path=join(root,'feature-sdk-retention.json');
 const retention=await readFile(path,'utf8').then(JSON.parse,()=>({pendingConfigurations:[],reason:'Latest-only feature compatibility and performance consume these SDKs next',latestOnly:true}));
 retention.pendingConfigurations=[...new Set([...retention.pendingConfigurations,configuration])].sort();
 await atomicJSON(path,retention);
}
const inventory=new Map(template.workloads.map(w=>[w.id,w.sha256]));
const suite=(await readCache(template.corpusRoot)).filter(w=>inventory.has(w.id));
if(suite.length!==inventory.size)throw Error('Frozen corpus incomplete');
let checkoutCapacity;
async function run(program,args,options={}) {
 const execute=signal=>signal?runCommand(program,args,{env,cwd:process.cwd(),log:join(root,engine+'-history.log'),...options,signal}):new Promise((yes,no)=>{const path=join(root,engine+'-history.log'),fd=openSync(path,'a'),start=fstatSync(fd).size;const reserved=reservedBuildCommand(program,args,{env});const child=spawn(reserved.program,reserved.args,{env,cwd:process.cwd(),stdio:['ignore',fd,fd],...options});closeSync(fd);child.on('error',no);child.on('exit',code=>code===0?yes():no(historyCommandError(program,code,path,start)));});
 const guarded=async()=>{
  if(!checkoutCapacity||program!=='git'||!args.some(arg=>['fetch','checkout','clone'].includes(arg)))return execute();
  if(!checkoutCapacity.sdkBudget&&!await stat(join(checkoutCapacity.directory,engine+'-build.json')).catch(()=>null)){checkoutCapacity.sdkBudget=createSDKBuildBudget(env);env.WASMFYI_SDK_BUILD_DEADLINE_AT_MS=String(checkoutCapacity.sdkBudget.deadlineAt);}
  return withHistoricalCheckoutCapacity({...checkoutCapacity,env,operation:()=>checkoutCapacity.sdkBudget?checkoutCapacity.sdkBudget.run(execute):execute()});
 };
 return args.some(arg=>String(arg).endsWith('benchmark-history-worker.mjs'))?execute():withBuildLock(root,guarded);
}
const controller=join(root,'controller-year');
if(!await stat(controller).catch(()=>null))await run('go',['build','-o',controller,'./cmd/wasmbench'],{cwd:base});
for(const pin of plan.pins.filter(p=>historyPinAllowed(p,template)&&historyWeekMatches(p,process.env.WASMFYI_HISTORY_WEEK)&&p.engine===engine&&p.status==='planned'&&(!selectedRefs.size||selectedRefs.has(p.tag||p.revision))).sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek))) {
 if(Date.parse(pin.targetWeek)<Date.parse(plan.cutoff)||Date.parse(pin.targetWeek)>Date.parse(plan.anchor))throw Error('Pin outside year');
 for(const configuration of pin.configurations) {
  const pinKey=[configuration,pin.targetType,pin.tag||pin.revision,pin.targetWeek].join('|');
  await retainPreparedConfiguration(configuration);
  if(prepareOnly)status.completed=status.completed.filter(x=>x.pinKey!==pinKey);
  else if(status.completed.some(x=>x.pinKey===pinKey))continue;
  const label=[configuration,pin.tag||pin.revision,pin.targetType,pin.targetWeek].join('-').replace(/[^a-zA-Z0-9.-]/g,'_');
  const directory=join(root,'engine-builds',label);await mkdir(directory,{recursive:true});
  // Cranelift and Winch use the same SDK executable, selected by --winch.
  // Keep separate result jobs while sharing the expensive source build.
  const buildDirectory=await historyBuildDirectory(root,pin,configuration);
  checkoutCapacity?.sdkBudget?.dispose();delete env.WASMFYI_SDK_BUILD_DEADLINE_AT_MS;
  checkoutCapacity={directory:buildDirectory,engine,configuration,revision:pin.revision};
  await mkdir(buildDirectory,{recursive:true});
  status.current={engine,configuration,ref:pin.tag||pin.revision,asOf:pin.targetWeek};await atomicJSON(statusPath,status);
  console.log(JSON.stringify({event:'build',...status.current}));
  try {
   let harness=join(buildDirectory,'harness'),buildEnv={...env},revision=pin.revision,unavailable=null,jobController=controller;
   if(needsHistoricalSourceBuild(pin)) {
    const source=join(buildDirectory,'sources',engine);await mkdir(source,{recursive:true});
    if(!await stat(join(source,'.git')).catch(()=>null)){await run('git',['init',source]);await run('git',['-C',source,'remote','add','origin','https://github.com/'+pin.repository+'.git']);}
    if(!await hasPinnedCommit(source,pin.revision))await run('git',['-C',source,'fetch','--depth','1','origin',pin.revision]);
    await run('git',['-C',source,'checkout','--detach',pin.revision]);
    if(engine==='wizard')unavailable=wizardArchitectureUnavailable(configuration);
    if(engine==='wamr')unavailable=await wamrArchitectureUnavailable(source,configuration);
    if(engine==='wasmedge')unavailable=await wasmedgeJITUnavailable(source,configuration);
    await atomicJSON(join(buildDirectory,'pins.json'),{pins:[{...pin,configurations:[configuration]}]});
    await atomicJSON(join(buildDirectory,'suite.json'),suite);
    if(unavailable){harness=base;await atomicJSON(join(buildDirectory,'unsupported-platform.json'),unavailable);}
    else {
    const receiptPath=join(buildDirectory,engine+'-build.json');
    if(!await stat(receiptPath).catch(()=>null))await run(process.execPath,['scripts/weekly-build.mjs',buildDirectory,engine,base]);
    let receipt=JSON.parse(await readFile(receiptPath));if(engine==='v8')receipt=await ensureV8BindingPolicy(root,buildDirectory,receipt);harness=receipt.root;jobController=receipt.controller||controller;buildEnv={...env,...receipt.env};
    }
   } else {
    if(!await stat(harness).catch(()=>null))await copyHistoricalHarness(base,harness);
    const bindingPath=join(buildDirectory,'binding.json');let binding;
    if(await stat(bindingPath).catch(()=>null)){binding=JSON.parse(await readFile(bindingPath));Object.assign(buildEnv,binding.environment);}
    else {
     await restoreHistoricalHarnessSources(base,harness);
     const invoke=(...args)=>{
      if(args[0]==='build'&&configuration.startsWith('wasmtime')) {
       command('cargo',['build','--release','--locked','--no-default-features','--manifest-path',join(harness,'adapters/wasmtime/Cargo.toml'),'--bin','adapter-wasmtime'],{cwd:harness,env:buildEnv,stdio:'inherit'});
      } else command(controller,args,{cwd:harness,env:buildEnv,stdio:'inherit'});
     };
     try {binding=await withBuildLock(root,()=>buildHistoricalBinding({root:harness,pin,configuration,invoke,env:buildEnv}));}
     catch(error){if(!['UNSUPPORTED_PLATFORM','UNSUPPORTED_BACKEND'].includes(error.code))throw error;unavailable=error.proof||{reason:String(error)};await atomicJSON(join(buildDirectory,'unsupported-platform.json'),unavailable);binding={source:{revision:unavailable.revision||pin.revision||pin.tag},unsupportedPlatform:unavailable};}
     binding.environment=Object.fromEntries(Object.entries(buildEnv).filter(([k])=>k.startsWith('WASMBENCH_')));await atomicJSON(bindingPath,binding);
    }
    unavailable ||=binding.unsupportedPlatform||null;
    revision=pin.revision||binding.source.revision||binding.source.archiveSha256||pin.tag;
   }
   if(!unavailable)await pruneRustIntermediates(harness);
   if(engine==='wamr')buildEnv.WASMBENCH_WAMR_MODE=configuration==='wamr'?'interpreter':configuration.replace(/^wamr-/, '');
   const job={id:'history-'+template.collection.samples+'-'+label,engine:configuration,harness,controller:jobController,env:Object.fromEntries(Object.entries(buildEnv).filter(([k])=>k.startsWith('WASMBENCH_'))),historical:true,source:{repository:pin.repository,revision,ref:pin.tag||'main@'+revision.slice(0,8),asOf:pin.targetWeek,kind:pin.targetType==='main'?'snapshot':'release',...(pin.dateBasis?{dateBasis:pin.dateBasis}:{})}};
   if(engine==='v8'&&buildEnv.WASMBENCH_V8_TURBOSHAFT_POLICY)job.backend='turboshaft';
   if(unavailable){job.unavailableReason=unavailable.reason;job.backend=configuration==='wamr-fast-jit'?'fast-jit':configuration;}
   if(!prepareOnly&&!unavailable&&env.WASMFYI_HISTORY_FAST!=='1')await qualifyHistoryStartup({directory,configuration,suite,harness,controller:jobController,source:job.source,env:buildEnv,run});
   const collection=engine==='zwasm'?{...template.collection,callBatchOperations:10000}:template.collection;
   await atomicJSON(join(directory,'plan.json'),{...template,collection,anchor:plan.anchor,cutoff:plan.cutoff,captureDirectory:join(root,'captures'),jobs:[job]});
   if(prepareOnly){
    status.completed.push({pinKey,engine,configuration,asOf:pin.targetWeek,ref:job.source.ref,prepared:true,captures:0});
    status.errors=status.errors.filter(error=>error.pinKey!==pinKey);
    await atomicJSON(statusPath,status);continue;
   }
   await run(process.execPath,['scripts/benchmark-history-worker.mjs',directory]);
   const result=JSON.parse(await readFile(join(directory,'status.json')));
   if(!completedHistoryJob(result,suite.length))throw Error('Incomplete collection '+result.status+'; '+result.errors.length+' errors');
   status.completed.push({pinKey,engine,configuration,asOf:pin.targetWeek,ref:job.source.ref,captures:result.completed,workloadErrors:result.errors});status.errors=status.errors.filter(error=>error.pinKey!==pinKey);
  }catch(error){status.errors.push({pinKey,...status.current,error:String(error)});console.error(error);}
  status.updated=new Date().toISOString();await atomicJSON(statusPath,status);
 }
}
status.current=null;status.status=status.errors.length?'needs-repair':'completed';await atomicJSON(statusPath,status);
