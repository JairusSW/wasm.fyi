import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {readCache,verifyWorkloads,atomicJSON} from './lib/benchmark-plan.mjs';
import {collectLatencies} from './lib/latency-capture.mjs';
const root=process.env.WAGO_COMPARISON_ROOT; if(!root)throw Error('Missing comparison root');
const versions=[['main','7aa401f29a33eb9050559aab5488cdb307f5a078'],['beta.12','a3c9d5b2097640899eb37cd5cc68b7bfc348de47'],['beta.11','9f01d145d54ac7ab458b6b2f6047db90a757410a']];
const workloads=(await readCache(process.env.WAGO_CORPUS_ROOT||process.cwd())).filter(w=>(process.env.WAGO_CALLS_ONLY?['mechanisms/host-to-wasm-call','mechanisms/wasm-host-wasm-loop'].includes(w.id):w.id.startsWith('wago/'))&&w.abi!=='wasi-command');
if(!workloads.length)throw Error('No Wago core workloads');
await verifyWorkloads(workloads);
const settings=JSON.parse(await readFile('wasmbench.config.json'));
const collection={...settings.collection,launches:3,samples:3};
await atomicJSON(join(root,'selection.json'),{versions,workloads:workloads.map(w=>({id:w.id,sha256:w.sha256})),collection});
const captures=Object.fromEntries(versions.map(([name])=>[name,[]]));
const errors=[];let completed=0,runnerMs=0,captureMs=0;
const started=new Date().toISOString();
await mkdir(join(root,'results'),{recursive:true});
async function state(status){await atomicJSON(join(root,'status.json'),{status,started,updated:new Date().toISOString(),completed,total:workloads.length*3,errors,runnerMs,captureMs});}
await state('running');
for(const [name,revision] of versions){
 for(let index=0;index<workloads.length;index++){
  const workload=workloads[index];workload.artifactName ||= basename(workload.artifact);
  const directory=join(root,'jobs',String(index).padStart(3,'0')+'-'+name);
  await mkdir(directory,{recursive:true});
  await atomicJSON(join(directory,'wago-suite.json'),[workload]);
  await rm(join(root,'harness/bin/adapter-wago'),{force:true});
  await copyFile(join(root,'adapter-'+name),join(root,'harness/bin/adapter-wago'));
  process.env.WASMBENCH_WAGO_REVISION=revision;
  console.log(JSON.stringify({event:'start',workload:workload.id,version:name,completed,total:workloads.length*3}));
  try{
   const capture=await collectLatencies({directory,workloads:[workload],engines:['wago'],collection,onTiming:t=>{runnerMs+=t.runnerMs;captureMs+=t.captureMs},run:async(...args)=>new Promise((resolve,reject)=>{
    const child=spawn(process.platform==='linux'?'taskset':join(root,'controller'),process.platform==='linux'?['--cpu-list','2',join(root,'controller'),...args]:args,{cwd:join(root,'harness'),env:{...process.env,WASMBENCH_RECORD_FAILURES:'1'},stdio:['ignore','ignore','pipe']});
    let error='';child.stderr.on('data',d=>{error=(error+d).slice(-16384)});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(error)));
   })});
   for(const row of capture.results)row.engine='wago-'+name;
   captures[name].push(capture);
   await atomicJSON(join(root,'results',String(index).padStart(3,'0')+'-'+name+'.json'),capture);
   console.log(JSON.stringify({event:'done',workload:workload.id,version:name,statuses:capture.results.map(r=>[r.phase,r.latencyStatus])}));
  }catch(error){errors.push({workload:workload.id,version:name,message:String(error)});console.error(error);}
  completed++;await state('running');
 }
}
await state(errors.length?'completed-with-errors':'completed');
console.log(JSON.stringify({event:'finished',completed,errors,runnerMs,captureMs}));
