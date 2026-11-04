// Verify actual source-bound files, rather than treating supervisor exits as coverage.
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {digest} from './lib/wasmbench.mjs';
import {readCache} from './lib/benchmark-plan.mjs';
import {workloadContract} from './lib/workload-contract.mjs';
import {reusableCapture} from './lib/history-scope.mjs';
import {featureCampaignPlatform,featureInputIdentity,featureLedgerKey} from './lib/feature-campaign-identity.mjs';
import {featureScenarios} from './lib/feature-scenario-policy.mjs';
import {assertCapturedOutcome} from './lib/capture-audit-outcome.mjs';
import {WASMTIME_FEATURE_POLICY,wasmtimeProposalsForBackend} from './lib/wasmtime-feature-policy.mjs';
const root=resolve(process.argv[2]),selected=new Set(process.argv.slice(3));
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const plan=await read(join(root,'source-plan.json')),template=await read(join(root,'collection-template.json')),config=await read(join(root,'runner-config.json'));
const mainInventory=new Set(template.workloads.map(w=>w.id));
const main=(await readCache(template.corpusRoot)).filter(w=>mainInventory.has(w.id));
if(main.length!==mainInventory.size)throw Error('Main inventory is incomplete');
const suites=Object.fromEntries(await Promise.all(['compatibility','performance','compile','lifecycle'].map(async kind=>[kind,await read(join(config.inputs,kind+'.json'))])));
const platform=featureCampaignPlatform(template);
const inputIdentity=featureInputIdentity(suites),hostKey=digest(Buffer.from(JSON.stringify(platform)));
const ledger=await read(join(root,'latest-features/ledger.json')).catch(()=>({items:{},completedEngines:[]}));
const shellSignatureRepairs=await read(join(root,'shell-signature-repair-targets.json')).catch(()=>({}));
const clean=value=>value.replace(/[^a-zA-Z0-9.-]/g,'_');
function jobID(pin,engine){
 if(['wago','wazero','wasm2go'].includes(pin.engine))return 'history-'+template.collection.samples+'-'+engine+'-'+pin.revision.slice(0,12)+'-'+pin.targetType+'-'+pin.targetWeek.replace(/[^0-9]/g,'')+(pin.dateBasis&&pin.tag?'-'+clean(pin.tag):'');
 if(pin.engine==='libwasm')return engine+'-'+pin.revision.slice(0,12)+'-'+pin.targetWeek.replace(/[^0-9]/g,'');
 return 'history-'+template.collection.samples+'-'+clean([engine,pin.tag||pin.revision,pin.targetType,pin.targetWeek].join('-'));
}
function checkRows(capture,pin,engine,workload,phases){
 if(capture.source?.revision!==pin.revision||capture.source?.asOf!==pin.targetWeek)throw Error('Source identity mismatch');
 if(['os','arch','cpu'].some(key=>capture.platform?.[key]!==platform[key]))throw Error('Capture belongs to another machine');
 const contract=workloadContract(workload),rows=capture.results.filter(row=>row.engine===engine&&row.workload===workload.id&&row.artifactSha256===workload.sha256&&row.contractSha256===contract);
 if(!phases.every(phase=>rows.some(row=>row.phase===phase)))throw Error('Required phases absent');
 for(const row of rows){
  if(!row.version||row.version==='unknown')throw Error('Runtime version absent');
  for(const [field,value] of [['latencyStatus','latencyNs'],['memoryStatus','peakRssBytes'],['codeStatus','codeBytes']]){
   if(!['ok','failed','unsupported','disabled','not-measured'].includes(row[field]))throw Error('Metric disposition absent: '+field);
   if(row[field]==='ok'&&(!Number.isFinite(row[value])||row[value]<0))throw Error('Recorded metric absent or invalid: '+value);
  }
  if(row.codeStatus==='ok'&&!['engine-reported','native-image'].includes(row.codeKind))throw Error('Native-code measurement kind absent');
  if(row.latencyStatus==='ok'&&(!Array.isArray(row.samplesNs)||!row.samplesNs.length||row.samplesNs.some(n=>!Number.isFinite(n)||n<0)))throw Error('Recorded latency samples absent or invalid');
 }
}
const engines=[];
const exportRoot=process.env.WASMFYI_AUDIT_EXPORT_DIR?resolve(process.env.WASMFYI_AUDIT_EXPORT_DIR):null;
for(const pin of plan.pins.filter(p=>p.status==='planned'))for(const engine of pin.configurations){
 if(selected.size&&!selected.has(engine))continue;
 const exportPaths=[];
 const report={engine,revision:pin.revision,main:{complete:0,total:main.length},features:{},policiesComplete:true,issues:[]};
 let featurePolicyBuiltAt=0;
 let wasmtimeFeatureBinding;
 if(['wasmtime','wasmtime-winch'].includes(engine)){
  try{
   const directory=join(root,'sdk-builds',clean(['wasmtime',pin.targetType,pin.tag||pin.revision].join('-')));
   wasmtimeFeatureBinding=await read(join(directory,'wasmtime-feature-binding.json'));
   if(wasmtimeFeatureBinding.policy!==WASMTIME_FEATURE_POLICY||wasmtimeFeatureBinding.revision!==pin.revision||!wasmtimeFeatureBinding.qualified||!['gc','threads','exceptions'].every(feature=>wasmtimeFeatureBinding.qualificationProbes?.includes(feature)))throw Error('Wasmtime core proposal activation not qualified');
  }catch(error){report.policiesComplete=false;report.issues.push({kind:'feature-policy',error:String(error)})}
 }
 if(engine==='spidermonkey'){
  try{
   const directory=join(root,'sdk-builds',clean([engine,pin.targetType,pin.tag||pin.revision].join('-')));
   const binding=await read(join(directory,'spidermonkey-feature-binding.json'));
   if(binding.policy!=='spidermonkey-pref-argv-v2'||binding.revision!==pin.revision||!binding.sdk.flags.includes('--enable-wasm-memory-control')||!['wasm_memory_control','wasm_stack_switching'].every(pref=>binding.prefs.includes(pref)))throw Error('Source-declared proposal activation not qualified');
   featurePolicyBuiltAt=Date.parse(binding.builtAt);if(!Number.isFinite(featurePolicyBuiltAt))throw Error('Feature policy build time absent');
  }catch(error){report.policiesComplete=false;report.issues.push({kind:'feature-policy',error:String(error)})}
 }
 if(engine==='jsc'){
  try{
   const directory=join(root,'sdk-builds',clean([engine,pin.targetType,pin.tag||pin.revision].join('-')));
   const binding=await read(join(directory,'jsc-feature-binding.json'));
   if(binding.policy!=='jsc-wide-arithmetic-v1'||binding.revision!==pin.revision||!binding.wideArithmetic)throw Error('JSC wide arithmetic activation not qualified');
   featurePolicyBuiltAt=Date.parse(binding.builtAt);if(!Number.isFinite(featurePolicyBuiltAt))throw Error('Feature policy build time absent');
  }catch(error){report.policiesComplete=false;report.issues.push({kind:'feature-policy',error:String(error)})}
 }
 for(const workload of main){
  try{
   const filename=jobID(pin,engine)+'-'+digest(Buffer.from(workload.id)).slice(0,16)+'.json';
   const capture=await read(join(root,'captures',filename));
   assertCapturedOutcome(capture,await read(join(root,'failure-notes',filename)).catch(()=>null));
   checkRows(capture,pin,engine,workload,['compile','instantiate','first-call','steady']);
   if(!reusableCapture(capture,workload,capture.source,template.collection.samples,template.collection.adaptiveSampling,template.collection.retainRecordedSamples===true))throw Error('Capture sampling policy is not reusable');
   report.main.complete++;exportPaths.push(join(root,'captures',filename));
  }catch(error){if(report.issues.length<12)report.issues.push({kind:'main',workload:workload.id,error:String(error)})}
 }
 for(const [kind,workloads] of Object.entries(suites)){
  const count=report.features[kind]={complete:0,total:workloads.length};
  for(const workload of workloads){
   const key=featureLedgerKey(hostKey,engine,{revision:pin.revision,asOf:pin.targetWeek},kind,workload,inputIdentity),item=ledger.items[key];
   try{
    if(item?.status!=='completed'||!item.capture||item.capture.includes('/')||item.capture.includes('..'))throw Error('Current-suite ledger record absent');
    const capture=await read(join(root,'latest-features/captures',item.capture));
    if(wasmtimeFeatureBinding){
     const activated=workload.features?.some(feature=>wasmtimeProposalsForBackend(engine,platform.arch).includes(feature));
     if(activated&&capture.results.some(row=>['failed','unsupported'].includes(row.latencyStatus))&&item.repairPolicy!==WASMTIME_FEATURE_POLICY&&capture.featureProfile!=='core-proposals')throw Error('Proposal outcome predates Wasmtime core feature activation');
     if(engine==='wasmtime'&&!wasmtimeFeatureBinding.baselineBranchHints&&workload.features?.includes('branch-hinting')&&item.repairPolicy!==WASMTIME_FEATURE_POLICY&&capture.featureProfile!=='core-proposals')throw Error('Branch metadata was not enabled for this observation');
    }
    assertCapturedOutcome(capture,await read(join(root,'failure-notes',item.capture)).catch(()=>null));
    if(shellSignatureRepairs[engine]?.includes(workload.id)&&capture.results.some(row=>['failed','unsupported'].includes(row.latencyStatus))&&item.repairPolicy!=='shell-compound-signature-v1')throw Error('Known shell signature admission defect has not been reconsidered');
    if(engine==='spidermonkey'&&/^features\/(?:memory-control|stack-switching)\//.test(workload.id)&&capture.results.some(row=>['failed','unsupported'].includes(row.latencyStatus))&&Date.parse(capture.capturedAt)<featurePolicyBuiltAt)throw Error('Proposal outcome predates explicit source feature activation');
    if(engine==='jsc'&&workload.id.startsWith('features/wide-arithmetic/')&&capture.results.some(row=>['failed','unsupported'].includes(row.latencyStatus))&&Date.parse(capture.capturedAt)<featurePolicyBuiltAt)throw Error('Proposal outcome predates explicit source feature activation');
    checkRows(capture,pin,engine,workload,featureScenarios(kind,workload).split(','));count.complete++;exportPaths.push(join(root,'latest-features/captures',item.capture));
   }catch(error){if(report.issues.length<12)report.issues.push({kind,workload:workload.id,error:String(error)})}
  }
 }
 report.complete=report.policiesComplete&&[report.main,...Object.values(report.features)].every(count=>count.complete===count.total);
 if(exportRoot&&report.complete){
  await mkdir(join(exportRoot,'captures'),{recursive:true});
  for(const path of exportPaths)await cp(path,join(exportRoot,'captures',path.split('/').at(-1)));
 }
 engines.push(report);
}
const report={checkedAt:new Date().toISOString(),inputIdentity,complete:engines.length>0&&engines.every(engine=>engine.complete),engines};
await writeFile(join(root,selected.size?'coverage-audit-selected.json':'coverage-audit.json'),JSON.stringify(report,null,2)+'\n');
for(const engine of engines)console.log(JSON.stringify({engine:engine.engine,complete:engine.complete,main:engine.main,features:engine.features,issues:engine.issues.slice(0,2)}));

if(exportRoot){
 const complete=new Set(engines.filter(e=>e.complete).map(e=>e.engine));
 await writeFile(join(exportRoot,'source-plan.json'),JSON.stringify({...plan,pins:plan.pins.map(p=>({...p,configurations:p.configurations.filter(c=>complete.has(c))})).filter(p=>p.configurations.length)},null,2)+'\n');
 await writeFile(join(exportRoot,'collection-template.json'),JSON.stringify({collection:template.collection})+'\n');
 await writeFile(join(exportRoot,'coverage-audit.json'),JSON.stringify(report,null,2)+'\n');
}
