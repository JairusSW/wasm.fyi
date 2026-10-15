import {sharedDeviceSliceMs} from './lib/shared-device-slice.mjs';
import {restoredWorkloadFailure} from './lib/resumed-workload-failure.mjs';
import {selectRepairPhases,mergePhaseRepair} from './lib/phase-repair.mjs';
import {workloadContract} from './lib/workload-contract.mjs';
import {historyWorkloadFailure,workloadBudgetMs} from './lib/history-workload-failure.mjs';
// Compact native collection for current builds and source-pinned historical jobs.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {runBenchmarkProcess} from './lib/benchmark-process.mjs';
import {cpus} from 'node:os';
import {fileURLToPath} from 'node:url';
import {readCache,verifyWorkloads,atomicJSON} from './lib/benchmark-plan.mjs';
import {collectLatencies} from './lib/latency-capture.mjs';
import {reusableCapture,validateHistoricalScope} from './lib/history-scope.mjs';
import {digest} from './lib/wasmbench.mjs';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
// On Apple, reserve through the shared device coordinator before taking the
// repository's own lock. Work slices release both locks between reservations.
if(process.platform==='darwin'&&process.env.WASMBENCH_SHARED_DEVICE_RESERVED!=='1'){
 const coordinator=fileURLToPath(new URL('./shared-device-run.py',import.meta.url));
 const child=spawn('python3',[coordinator,'--repeat-slices','--','env','WASMBENCH_SHARED_DEVICE_RESERVED=1',process.execPath,fileURLToPath(import.meta.url),...process.argv.slice(2)],{stdio:'inherit'});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
 process.exit(code??1);
}
const directory=process.argv[2];if(!directory)throw Error('A job-plan directory is required');
const sliceDeadline=performance.now()+(process.platform==='darwin'?await sharedDeviceSliceMs(directory):30*60*1000);
const plan=JSON.parse(await readFile(join(directory,'plan.json')));
if(!plan.platformSpecs){const memoryBytes=process.platform==='darwin'?Number(execFileSync('sysctl',['-n','hw.memsize']).toString().trim()):process.platform==='linux'?Number((await readFile('/proc/meminfo','utf8')).match(/^MemTotal:\s+(\d+)/m)?.[1]||0)*1024:0;plan.platformSpecs={cores:cpus().length,memoryBytes};}
plan.jobs=plan.jobs.filter(job=>!['deno','wasm2js','wasm2rs'].includes(job.engine));
const requested=plan.workloads?new Map(plan.workloads.map(w=>[w.id,w.sha256])):null;
const workloads=(await readCache(plan.corpusRoot)).filter(w=>!requested||requested.has(w.id)).filter(w=>w.abi!=='wasi-command'&&!/^features\/wasi(?:-|\/)/.test(w.id));
if(requested)for(const w of workloads)if(w.sha256!==requested.get(w.id))throw Error(`Artifact differs from shared inventory: ${w.id}`);
if(requested&&workloads.length!==requested.size)throw Error('Shared inventory is incomplete on this host');
validateHistoricalScope(plan,workloads);
await verifyWorkloads(workloads);
for(const w of workloads){w.bytes=(await stat(w.artifact)).size;w.artifactName ||=basename(w.artifact);}
const output=plan.captureDirectory||join(directory,'captures');await mkdir(output,{recursive:true});
const status={status:'running',started:new Date().toISOString(),updated:'',machine:plan.machine,current:null,completed:0,total:plan.jobs.length*workloads.length,errors:[],resourceFailures:[],resourceStatuses:{memory:{},code:{}},runnerMs:0,captureMs:0};
function recordResources(capture){
 for(const [metric,field] of [['memory','memoryStatus'],['code','codeStatus']]){
  const failed=[];
  for(const row of capture.results){
   const value=row[field]||'not-collected';
   status.resourceStatuses[metric][value]=(status.resourceStatuses[metric][value]||0)+1;
   if(row.latencyStatus==='ok'&&value==='failed')failed.push(row.phase);
  }
  if(failed.length)status.resourceFailures.push({engine:capture.results[0].engine,source:capture.source,workload:capture.results[0].workload,metric,phases:failed});
 }
}
const abort=new AbortController();for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>{status.status='paused';abort.abort()});
async function save(){status.updated=new Date().toISOString();await atomicJSON(join(directory,'status.json'),status);}
await save();
let releaseMeasurement;
try{releaseMeasurement=await acquireMeasurementLock(join(output,'..','measurement-lock'),process.platform==='darwin'?AbortSignal.any([abort.signal,AbortSignal.timeout(2000)]):abort.signal);}
catch(error){if(process.platform==='darwin'&&!abort.signal.aborted&&['TimeoutError','AbortError'].includes(error.name)){status.status='waiting-host-lock';await save();process.exit(75);}throw error;}

try {
for(const job of plan.jobs){
 if(abort.signal.aborted)break;
 // Refuse targets outside the authorized window, including accidental old plans.
 if(job.historical&&(Date.parse(job.source.asOf)<Date.parse(plan.cutoff)||Date.parse(job.source.asOf)>Date.parse(plan.anchor)))throw Error('Historical source outside requested window');
 const env={...process.env,...plan.env,...job.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',GOMAXPROCS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1',WASMBENCH_CODE_SIZE_ONLY:'1',WASMBENCH_SINGLE_CORE:plan.executionPolicy?.measurementCores===1?'1':'0',WASMBENCH_RECORD_FAILURES:'1',WASMBENCH_SOURCE_JSON:JSON.stringify(job.source)};
 for(const workload of workloads){
  if(abort.signal.aborted)break;
  if(process.platform==='darwin'&&performance.now()>=sliceDeadline){status.status='yielded';abort.abort();break;}
  const key=job.id+'-'+digest(Buffer.from(workload.id)).slice(0,16),file=join(output,key+'.json');
  const existing=await readFile(file,'utf8').then(JSON.parse,()=>null);
  const repairPhases=selectRepairPhases(existing,workload,job);
  if(repairPhases&&job.unavailableReason)throw Error('Cannot repair phases without a runnable adapter');
  if(repairPhases?.length===0||!repairPhases&&!job.forceCapture&&reusableCapture(existing,workload,job.source,plan.collection.samples,plan.collection.adaptiveSampling,job.historical&&plan.collection.retainRecordedSamples===true)){
   if(existing?.results.some(row=>row.latencyStatus==='failed')){
    let note=null;
    for(const notes of [join(directory,'failure-notes'),join(output,'..','failure-notes')]){
     note=await readFile(join(notes,key+'.json'),'utf8').then(text=>{try{return JSON.parse(text)}catch{return null}},()=>null);
     if(note)break;
    }
    const failure=restoredWorkloadFailure(existing,note,job,workload);if(failure)status.errors.push(failure);
   }
   recordResources(existing);status.completed++;continue;
  }
  if(repairPhases){const originals=join(directory,'phase-repair-originals');await mkdir(originals,{recursive:true});const backup=join(originals,key+'.json');if(!await stat(backup).catch(()=>null))await atomicJSON(backup,existing);}
  const scratch=join(directory,'scratch',key);await mkdir(scratch,{recursive:true});await atomicJSON(join(scratch,'wago-suite.json'),[workload]);
  status.current={engine:job.engine,source:job.source.ref,asOf:job.source.asOf,workload:workload.id};await save();console.log(JSON.stringify({event:'start',...status.current}));
  // The collector reads only this source descriptor; the controller pins actual adapter identities.
  process.env.WASMBENCH_SOURCE_JSON=env.WASMBENCH_SOURCE_JSON;
  if(job.engine==='wago'&&job.source.revision.length===40)process.env.WASMBENCH_WAGO_REVISION=job.source.revision;else delete process.env.WASMBENCH_WAGO_REVISION;
  const workloadSignal=AbortSignal.any([abort.signal,AbortSignal.timeout(workloadBudgetMs)]);
  try{
   if(job.unavailableReason){const contractSha256=workloadContract(workload);const capture={capturedAt:new Date().toISOString(),source:job.source,platform:{os:process.platform,arch:process.arch==='x64'?'amd64':'arm64',cpu:cpus()[0].model,cores:plan.platformSpecs.cores,kernel:execFileSync('uname',['-srv']).toString().trim(),memoryBytes:plan.platformSpecs.memoryBytes},results:['compile','instantiate','first-call','steady'].map(phase=>({workload:workload.id,wasm:workload.artifactName,artifactSha256:workload.sha256,contractSha256,engine:job.engine,version:job.source.revision,backend:job.backend||job.engine,phase,timingSamples:0,latencyStatus:'unsupported',latencyNs:null,memoryStatus:'unsupported',peakRssBytes:null,codeStatus:'unsupported',codeBytes:null,codeKind:null}))};await atomicJSON(file,capture);recordResources(capture);status.completed++;await save();continue;}
   let capture=await collectLatencies({directory:scratch,workloads:[workload],engines:[job.engine],collection:repairPhases?{...plan.collection,scenarios:repairPhases.join(',')}:plan.collection,onTiming:t=>{status.runnerMs+=t.runnerMs;status.captureMs+=t.captureMs},run:async(...args)=>{
    const controller=job.controller||plan.controller;
    const pinned=process.platform==='linux'&&plan.cpu!=null;
    const foreground=process.platform==='darwin'&&plan.executionPolicy?.measurementCores===1;
    return runBenchmarkProcess(pinned?'taskset':foreground?'taskpolicy':controller,pinned?['--cpu-list',String(plan.cpu),controller,...args]:foreground?['-a','-t','0','-l','0',controller,...args]:args,{cwd:job.harness||plan.harness,env,signal:workloadSignal});
   }});
   if(plan.platformSpecs){if(plan.platformSpecs.cores)capture.platform.cores=plan.platformSpecs.cores;if(plan.platformSpecs.memoryBytes)capture.platform.memoryBytes=plan.platformSpecs.memoryBytes;}
   if(capture.source?.kind==='current'){capture.source.revision=capture.results[0].version;capture.source.ref=capture.results[0].version}
   if(job.displayEngine)for(const row of capture.results)row.engine=job.displayEngine;
   if(repairPhases)capture=mergePhaseRepair(existing,capture,repairPhases);
   await atomicJSON(file,capture);
   recordResources(capture);
   // Producers can return verified run records containing failed trials rather
   // than throw. Keep those failures visible to the campaign completion audit.
   const failedPhases=capture.results.filter(row=>row.latencyStatus==='failed').map(row=>row.phase);
   if(failedPhases.length){
    const failures=await readFile(join(scratch,'failures.json'),'utf8').then(JSON.parse,()=>[]);
    const note={capturedAt:capture.capturedAt,source:job.source,engine:job.displayEngine||job.engine,workload:workload.id,kind:'failed-trials',phases:failedPhases,failures,reason:failures.map(f=>f.reason).filter(Boolean).join('; ')||'Producer returned failed latency trials'};
    status.errors.push({...status.current,error:note.reason,kind:note.kind,phases:failedPhases});
    for(const notes of [join(directory,'failure-notes'),join(output,'..','failure-notes')]){await mkdir(notes,{recursive:true});await atomicJSON(join(notes,key+'.json'),note);}
   }
   console.log(JSON.stringify({event:'captured',...status.current,statuses:capture.results.map(r=>[r.phase,r.latencyStatus]),resources:capture.results.map(r=>({phase:r.phase,memory:r.memoryStatus,code:r.codeStatus}))}));
  }catch(error){if(!abort.signal.aborted){
   const {capture,note}=historyWorkloadFailure({workload,job,error,signal:workloadSignal,platform:{os:process.platform,arch:process.arch==='x64'?'amd64':'arm64',cpu:cpus()[0].model,cores:plan.platformSpecs.cores,kernel:execFileSync('uname',['-srv']).toString().trim(),memoryBytes:plan.platformSpecs.memoryBytes}});
   status.errors.push({...status.current,error:note.reason,kind:note.kind,budgetMs:note.budgetMs});console.error(error);
   // Persist a failed outcome so resume cannot retry a timed-out/crashed
   // workload forever. The separate status record retains its actual reason.
   const notes=join(directory,'failure-notes');await mkdir(notes,{recursive:true});
   await atomicJSON(join(notes,key+'.json'),note);
   const campaignNotes=join(output,'..','failure-notes');await mkdir(campaignNotes,{recursive:true});
   await atomicJSON(join(campaignNotes,key+'.json'),note);
   const persisted=repairPhases?mergePhaseRepair(existing,{...capture,results:capture.results.filter(r=>repairPhases.includes(r.phase)).map(r=>({...r,version:existing.results.find(before=>before.phase===r.phase).version}))},repairPhases):capture;await atomicJSON(file,persisted);recordResources(persisted);
  }}
  status.completed++;await save();
 }
}
if(!abort.signal.aborted)status.status=status.errors.length?'completed-with-errors':'completed';status.current=null;await save();
} finally {await releaseMeasurement();}

if(status.status==='yielded')process.exitCode=76;
