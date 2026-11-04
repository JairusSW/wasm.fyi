import{readFile,writeFile,mkdir}from'node:fs/promises';
import{join,resolve}from'node:path';
import{withBuildLock}from'./lib/measurement-lock.mjs';
import{applyWasm2GoFeaturePolicy}from'./lib/wasm2go-feature-policy.mjs';
import{runCommand}from'./lib/benchmark-process.mjs';
import{digest}from'./lib/wasmbench.mjs';
const root=resolve(process.argv[2]),read=async p=>JSON.parse(await readFile(p,'utf8'));
const source=(await read(join(root,'source-plan.json'))).pins.find(p=>p.engine==='wasm2go');
const directory=join(root,'builds','wasm2go-'+source.revision),receiptPath=join(directory,'wasm2go-build.json');
const receipt=await read(receiptPath),template=await read(join(root,'collection-template.json'));
if(receipt.pin.revision!==source.revision)throw Error('Wasm2go source binding changed');
await withBuildLock(root,async()=>{
 const policy=await applyWasm2GoFeaturePolicy(receipt.root);
 await runCommand('go',['build','-trimpath','-o',join(receipt.root,'bin/adapter-wasm2go'),'./adapters/wasm2go'],{cwd:receipt.root,env:{...process.env,...template.env,...receipt.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'},log:join(root,'wasm2go-memory-repair-build.log')});
 receipt.runtime.file_sha256[join(receipt.root,'bin/adapter-wasm2go')]=digest(await readFile(join(receipt.root,'bin/adapter-wasm2go')));
 receipt.provenance.featurePolicy=policy;receipt.memoryBindingRepairedAt=new Date().toISOString();
 await writeFile(receiptPath,JSON.stringify(receipt,null,2));
});
const original=join(directory,'runs',source.targetType+'-'+source.targetWeek.replace(/[^0-9]/g,'')+(source.dateBasis&&source.tag?'-'+source.tag.replace(/[^a-zA-Z0-9.-]/g,'_'):''));
const plan=await read(join(original,'plan.json'));
const repair=join(root,'wasm2go-memory-repair');await mkdir(repair,{recursive:true});
const affected=[];
for(const workload of plan.workloads){
 const file=join(plan.captureDirectory,plan.jobs[0].id+'-'+digest(Buffer.from(workload.id)).slice(0,16)+'.json');
 const capture=await read(file);
 if(capture.results.some(row=>row.latencyStatus==='failed'))affected.push(workload);
}
plan.workloads=affected;
plan.jobs=plan.jobs.map(job=>({...job,repairPhases:['compile','instantiate','first-call','steady'],repairReason:'wasm2go-embedded-memory-v2: repair adapter access to promoted memory fields; preserve all measured phases'}));
await writeFile(join(repair,'plan.json'),JSON.stringify(plan));
await runCommand(process.execPath,[join(import.meta.dirname,'benchmark-history-worker.mjs'),repair],{cwd:import.meta.dirname,log:join(root,'wasm2go-memory-repair.log')});
