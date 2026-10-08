// Probe real adapters; retain raw samples and independent launch identity.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
const plan=JSON.parse(await readFile(process.argv[2])),rows=[];
const median=a=>{a=[...a].sort((x,y)=>x-y);return a.length%2?a[a.length>>1]:(a[a.length/2-1]+a[a.length/2])/2;};
async function probe(config,w){
 const affinity=process.platform==='linux'?['taskset','-c',String(plan.cpu??2)]:process.platform==='darwin'?['/usr/sbin/taskpolicy','-a','-t','0','-l','0']:[];
 const command=[...affinity,...config.command];
 const started=process.hrtime.bigint();let timedRuntimeNs=0;
 const child=spawn(command[0],command.slice(1),{cwd:config.cwd,env:{...process.env,...config.env,GOMAXPROCS:'1',CARGO_BUILD_JOBS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1'},stdio:['pipe','pipe','ignore']});
 let spawnError;child.on('error',error=>{spawnError=error});child.stdin.on('error',error=>{spawnError=error});
 const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();let id=0;
 async function rpc(method,data={}){
  if(spawnError||child.stdin.destroyed)throw spawnError||Error('Adapter input closed');
  child.stdin.write(JSON.stringify({version:1,id:++id,method,...data})+'\n');
  let timer;try{const line=await Promise.race([lines.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Adapter timed out')),30000)})]);if(line.done)throw Error('Adapter exited');const response=JSON.parse(line.value);if(response.version!==1||response.id!==id)throw Error('Adapter protocol response mismatch');if(response.status!=='ok')throw Error(response.reason||response.status);return response;}finally{clearTimeout(timer)}
 }
 try{
  const description=(await rpc('describe')).description;
  await rpc('prepare',{prepare:{artifact:w.artifact,artifact_sha256:w.sha256,workload:w,profile:'timing'}});
  const run=async(operations,samples,warmup)=>{
   const result=await rpc('run',{run:{scenario:'steady',samples,operations,warmup,phase_barriers:false}});
   if(result.status!=='ok')throw Error(result.reason||result.status);
   const measured=(result.samples||[]).filter(s=>!s.warmup);
   if(measured.length!==samples||measured.some(s=>!s.verified||!Number.isSafeInteger(s.elapsed_ns)||s.elapsed_ns<0||!Number.isSafeInteger(s.operations)||s.operations<1))throw Error('Missing verified raw samples');
   timedRuntimeNs+=(result.samples||[]).reduce((sum,s)=>sum+s.elapsed_ns,0);
   measured.warmupElapsedNs=(result.samples||[]).filter(s=>s.warmup).reduce((sum,s)=>sum+s.elapsed_ns,0);
   return measured;
  };
  const pilot=await run(plan.fixedOperations||1,3,2),estimate=median(pilot.map(s=>s.elapsed_ns/s.operations));
  let requested=w.reset==='stateless'&&plan.targetNs?Math.max(1,Math.min(plan.maxOperations||1000000,Math.ceil(plan.targetNs/Math.max(estimate,1)))):plan.fixedOperations||1;
  let samples;let measuredWarmup=2;
  for(let attempt=0;attempt<5;attempt++){
   measuredWarmup=plan.minimumWarmupNs?Math.max(2,Math.min(100,Math.ceil(plan.minimumWarmupNs/Math.max(estimate*requested,1)))):2;
   samples=await run(requested,plan.samples||5,measuredWarmup);
   const minimum=Math.min(...samples.map(s=>s.elapsed_ns));
   if(!plan.targetNs||minimum>=plan.targetNs||w.reset!=='stateless')break;
   const next=Math.min(plan.maxOperations||1000000,Math.max(requested+1,Math.ceil(requested*plan.targetNs/Math.max(minimum,1)*1.25)));
   if(next===requested)break;requested=next;
  }
  const values=samples.map(s=>s.elapsed_ns/s.operations);
  const mean=values.reduce((a,b)=>a+b,0)/values.length,sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/(values.length-1));
  return {engine:config.id,version:description.runtime_version,workload:w.id,artifactSha256:w.sha256,reset:w.reset,unitsPerInvocation:w.units_per_invocation,status:'ok',medianNs:median(values),sampleSdNs:sd,cv:mean?sd/mean:0,wallNs:Number(process.hrtime.bigint()-started),timedRuntimeNs,requestedOperations:requested,warmupBatches:measuredWarmup,warmupElapsedNs:samples.warmupElapsedNs,durationQualified:!plan.targetNs||samples.every(s=>s.elapsed_ns>=plan.targetNs),samples};
 }catch(error){return {engine:config.id,workload:w.id,status:/unsupported|not supported|native Component Model/i.test(String(error))?'unsupported':'failed',reason:String(error)}}
 finally{child.kill('SIGTERM');child.stdin.destroy();}
}
await mkdir(join(plan.output,'..'),{recursive:true});
const release=await acquireMeasurementLock(join(plan.lockRoot,'measurement-lock'));
try{
 for(const config of plan.configurations)for(const w of plan.workloads)for(let launch=0;launch<(plan.launches||3);launch++){const row={...await probe(config,w),launch};rows.push(row);console.log(config.id,w.id,row.status,row.medianNs?.toFixed(0),row.cv?.toFixed(3));await writeFile(plan.output,JSON.stringify({launches:plan.launches||3,samples:plan.samples||5,targetNs:plan.targetNs||0,cpu:process.platform==='linux'?plan.cpu??2:null,affinity:process.platform==='linux'?'taskset':process.platform==='darwin'?'taskpolicy-priority':'inherited',rows},null,2)+'\n');}
}finally{await release()}
