import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {acquireMeasurementLock,withBuildLock} from './lib/measurement-lock.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {ensureWasmtimeFeatureBinding,wasmtimeProposalsForBackend,WASMTIME_FEATURE_POLICY} from './lib/wasmtime-feature-policy.mjs';
const root=resolve(process.argv[2]),read=async path=>JSON.parse(await readFile(path,'utf8'));
const config=await read(join(root,'runner-config.json')),template=await read(join(root,'collection-template.json'));
const release=await acquireMeasurementLock(join(root,'latest-features/ledger-writer-lock'));
const selections={};
try{
 let binding;
 await withBuildLock(root,async()=>{
  for(const name of await readdir(join(root,'sdk-builds'))){
   const directory=join(root,'sdk-builds',name),receipt=await read(join(directory,'wasmtime-build.json')).catch(()=>null);
   if(receipt){binding=await ensureWasmtimeFeatureBinding(directory,receipt,template.env,{inputs:config.inputs});break}
  }
  if(!binding?.qualified)throw Error('Wasmtime feature SDK not qualified');
 });
 const ledger=await read(join(root,'latest-features/ledger.json'));
 const workloads=(await Promise.all(['compatibility','performance','compile','lifecycle'].map(kind=>read(join(config.inputs,kind+'.json'))))).flat();
 for(const engine of ['wasmtime','wasmtime-winch']){
  const eligible=new Set(wasmtimeProposalsForBackend(engine)),repair=new Set(),branch=new Set();
  for(const workload of workloads){
   if(!workload.features?.some(feature=>eligible.has(feature)))continue;
   const prior=Object.values(ledger.items).filter(item=>item.engine===engine&&item.source?.revision===binding.revision&&item.workload===workload.id);
   if(engine==='wasmtime'&&!binding.baselineBranchHints&&workload.features.includes('branch-hinting')){
    if(prior.some(item=>item.repairPolicy!==WASMTIME_FEATURE_POLICY))branch.add(workload.id);
   }else if(prior.some(item=>item.repairPolicy!==WASMTIME_FEATURE_POLICY&&item.outcomes?.some(([,status])=>['failed','unsupported'].includes(status))))repair.add(workload.id);
  }
  selections[engine]={repair:[...repair],branch:[...branch]};
 }
 await writeFile(join(root,'wasmtime-feature-repair-selection.json'),JSON.stringify({policy:WASMTIME_FEATURE_POLICY,selectedAt:new Date().toISOString(),selections},null,2)+'\n');
}finally{await release()}
for(const [engine,selection] of Object.entries(selections))for(const kind of ['repair','branch']){
 if(!selection[kind].length)continue;
 const file=join(root,`wasmtime-${engine}-${kind}-workloads.json`);await writeFile(file,JSON.stringify(selection[kind])+'\n');
 await runCommand(config.node,[join(config.site,'scripts/latest-feature-campaign.mjs'),root,join(root,'latest-features'),config.inputs],{cwd:config.site,env:{...process.env,WASMFYI_FEATURE_ENGINES:engine,WASMFYI_FEATURE_REPAIR_ENGINES:engine,WASMFYI_FEATURE_REPAIR_WORKLOADS_FILE:file,WASMFYI_FEATURE_WORKLOADS_FILE:file,WASMFYI_FEATURE_REPAIR_POLICY:WASMTIME_FEATURE_POLICY,WASMFYI_FEATURE_REPAIR_DOCUMENTED_PROPOSALS:'1',WASMFYI_FEATURE_REPAIR_RETRY_COMPLETED:'1',WASMFYI_FEATURE_REPAIR_ALL:kind==='branch'?'1':'0'},log:join(root,'wasmtime-feature-repair.log')});
}
await runCommand(config.node,[join(config.site,'scripts/audit-current-campaign.mjs'),root,'wasmtime','wasmtime-winch'],{cwd:config.site,log:join(root,'wasmtime-feature-repair.log')});
const audit=await read(join(root,'coverage-audit-selected.json'));
if(!audit.complete)throw Error('Wasmtime feature repair audit incomplete');
console.log(JSON.stringify({completedAt:new Date().toISOString(),policy:WASMTIME_FEATURE_POLICY,counts:Object.fromEntries(Object.entries(selections).map(([engine,s])=>[engine,{repair:s.repair.length,branch:s.branch.length}]))}));
