// Compact native collection for current builds and source-pinned historical jobs.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {cpus} from 'node:os';
import {readCache,verifyWorkloads,atomicJSON} from './lib/benchmark-plan.mjs';
import {collectLatencies} from './lib/latency-capture.mjs';
import {reusableCapture} from './lib/history-scope.mjs';
import {digest} from './lib/wasmbench.mjs';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
const directory=process.argv[2];if(!directory)throw Error('A job-plan directory is required');
const plan=JSON.parse(await readFile(join(directory,'plan.json')));
if(!plan.platformSpecs){const memoryBytes=process.platform==='darwin'?Number(execFileSync('sysctl',['-n','hw.memsize']).toString().trim()):process.platform==='linux'?Number((await readFile('/proc/meminfo','utf8')).match(/^MemTotal:\s+(\d+)/m)?.[1]||0)*1024:0;plan.platformSpecs={cores:cpus().length,memoryBytes};}
plan.jobs=plan.jobs.filter(job=>!['deno','wasm2js','wasm2rs'].includes(job.engine));
const requested=plan.workloads?new Map(plan.workloads.map(w=>[w.id,w.sha256])):null;
const workloads=(await readCache(plan.corpusRoot)).filter(w=>!requested||requested.has(w.id)).filter(w=>w.abi!=='wasi-command'&&!/^features\/wasi(?:-|\/)/.test(w.id));
if(requested)for(const w of workloads)if(w.sha256!==requested.get(w.id))throw Error(`Artifact differs from shared inventory: ${w.id}`);
if(requested&&workloads.length!==requested.size)throw Error('Shared inventory is incomplete on this host');
await verifyWorkloads(workloads);
for(const w of workloads){w.bytes=(await stat(w.artifact)).size;w.artifactName ||=basename(w.artifact);}
const output=plan.captureDirectory||join(directory,'captures');await mkdir(output,{recursive:true});
const status={status:'running',started:new Date().toISOString(),updated:'',machine:plan.machine,current:null,completed:0,total:plan.jobs.length*workloads.length,errors:[],runnerMs:0,captureMs:0};
const abort=new AbortController();for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>{status.status='paused';abort.abort()});
async function save(){status.updated=new Date().toISOString();await atomicJSON(join(directory,'status.json'),status);}
await save();
const releaseMeasurement=await acquireMeasurementLock(join(output,'..','measurement-lock'),abort.signal);
try {
for(const job of plan.jobs){
 if(abort.signal.aborted)break;
 // Refuse targets outside the authorized window, including accidental old plans.
 if(job.historical&&(Date.parse(job.source.asOf)<Date.parse(plan.cutoff)||Date.parse(job.source.asOf)>Date.parse(plan.anchor)))throw Error('Historical source outside requested window');
 const env={...process.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',GOMAXPROCS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1',WASMBENCH_CODE_SIZE_ONLY:'1',WASMBENCH_SINGLE_CORE:plan.executionPolicy?.measurementCores===1?'1':'0',WASMBENCH_RECORD_FAILURES:'1',WASMBENCH_SOURCE_JSON:JSON.stringify(job.source)};
 for(const workload of workloads){
  if(abort.signal.aborted)break;
  const key=job.id+'-'+digest(Buffer.from(workload.id)).slice(0,16),file=join(output,key+'.json');
  const existing=await readFile(file,'utf8').then(JSON.parse,()=>null);
  if(!job.forceCapture&&reusableCapture(existing,workload,job.source,plan.collection.samples)){status.completed++;continue}
  const scratch=join(directory,'scratch',key);await mkdir(scratch,{recursive:true});await atomicJSON(join(scratch,'wago-suite.json'),[workload]);
  status.current={engine:job.engine,source:job.source.ref,asOf:job.source.asOf,workload:workload.id};await save();console.log(JSON.stringify({event:'start',...status.current}));
  // The collector reads only this source descriptor; the controller pins actual adapter identities.
  process.env.WASMBENCH_SOURCE_JSON=env.WASMBENCH_SOURCE_JSON;
  if(job.engine==='wago'&&job.source.revision.length===40)process.env.WASMBENCH_WAGO_REVISION=job.source.revision;else delete process.env.WASMBENCH_WAGO_REVISION;
  try{
   if(job.unavailableReason){const contractSha256=digest(Buffer.from(JSON.stringify({id:workload.id,sha256:workload.sha256,abi:workload.abi,export:workload.export,args:workload.args,oracle:workload.oracle,command:workload.command,reset:workload.reset})));const capture={capturedAt:new Date().toISOString(),source:job.source,platform:{os:process.platform,arch:process.arch==='x64'?'amd64':'arm64',cpu:cpus()[0].model,cores:plan.platformSpecs.cores,kernel:execFileSync('uname',['-srv']).toString().trim(),memoryBytes:plan.platformSpecs.memoryBytes},results:['compile','instantiate','first-call','steady'].map(phase=>({workload:workload.id,wasm:workload.artifactName,artifactSha256:workload.sha256,contractSha256,engine:job.engine,version:job.source.revision,backend:job.backend||job.engine,phase,timingSamples:0,latencyStatus:'unsupported',latencyNs:null,memoryStatus:'unsupported',peakRssBytes:null,codeStatus:'unsupported',codeBytes:null,codeKind:null}))};await atomicJSON(file,capture);status.completed++;await save();continue;}
   const capture=await collectLatencies({directory:scratch,workloads:[workload],engines:[job.engine],collection:plan.collection,onTiming:t=>{status.runnerMs+=t.runnerMs;status.captureMs+=t.captureMs},run:async(...args)=>new Promise((resolve,reject)=>{
    const controller=job.controller||plan.controller;
    const pinned=process.platform==='linux'&&plan.cpu!=null;
    const foreground=process.platform==='darwin'&&plan.executionPolicy?.measurementCores===1;
    const child=spawn(pinned?'taskset':foreground?'taskpolicy':controller,pinned?['--cpu-list',String(plan.cpu),controller,...args]:foreground?['-a','-t','0','-l','0',controller,...args]:args,{cwd:job.harness||plan.harness,env,signal:abort.signal,stdio:['ignore','ignore','pipe']});
    let error='';child.stderr.on('data',d=>error=(error+d).slice(-8192));child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(error||'Controller exited '+code)));
   })});
   if(plan.platformSpecs){if(plan.platformSpecs.cores)capture.platform.cores=plan.platformSpecs.cores;if(plan.platformSpecs.memoryBytes)capture.platform.memoryBytes=plan.platformSpecs.memoryBytes;}
   if(capture.source?.kind==='current'){capture.source.revision=capture.results[0].version;capture.source.ref=capture.results[0].version}
   if(job.displayEngine)for(const row of capture.results)row.engine=job.displayEngine;
   await atomicJSON(file,capture);console.log(JSON.stringify({event:'captured',...status.current,statuses:capture.results.map(r=>[r.phase,r.latencyStatus])}));
  }catch(error){if(!abort.signal.aborted){status.errors.push({...status.current,error:String(error)});console.error(error);}}
  status.completed++;await save();
 }
}
if(!abort.signal.aborted)status.status=status.errors.length?'completed-with-errors':'completed';status.current=null;await save();
} finally {await releaseMeasurement();}
