// Diagnose a prepared SDK under the host's shared measurement lock.
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {command as runNative} from './lib/wasmbench.mjs';
const [rootArg,directoryArg,engine,mode]=process.argv.slice(2),root=resolve(rootArg),directory=resolve(directoryArg);
if(mode&&mode!=='--check-performance-core')throw Error('Unknown SDK qualification mode');
const checkCore=mode==='--check-performance-core';
if(checkCore&&process.platform!=='darwin')throw Error('This CPU-class check requires macOS');
const template=JSON.parse(await readFile(join(root,'collection-template.json')));
const receipt=JSON.parse(await readFile(join(directory,engine+'-build.json')));
const suite=JSON.parse(await readFile(join(directory,'suite.json')));
const workloads=['applications/numeric-euclidean-gcd','mechanisms/wasm-to-host-call','mechanisms/wasm-host-wasm-loop'].map(id=>suite.find(w=>w.id===id));
if(workloads.some(w=>!w))throw Error('Required qualification fixture missing');
const state={pid:process.pid,status:'waiting-measurement-lock',configuration:receipt.runtime.id,started:new Date().toISOString()};
const save=()=>atomicJSON(join(directory,checkCore?'core-qualification-status.json':'qualification-status.json'),state);await save();
const release=await acquireMeasurementLock(join(root,'measurement-lock'));
let child;
try {
 state.status='qualifying';await save();
 const env={...process.env,...template.env,...receipt.env,GOMAXPROCS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',WASMBENCH_SINGLE_CORE:'1'};
 const command=receipt.runtime.command;
 const linux=process.platform==='linux';if(linux&&!Number.isInteger(template.cpu))throw Error('No fixed Linux measurement CPU');
 child=spawn(linux?'taskset':process.platform==='darwin'?'taskpolicy':command[0],linux?['--cpu-list',String(template.cpu),...command]:process.platform==='darwin'?['-a','-t','0','-l','0',...command]:command.slice(1),{cwd:receipt.root,env,stdio:['pipe','pipe','pipe']});
 let stderr='',exitError;child.stderr.on('data',data=>stderr=(stderr+data).slice(-8192));child.on('error',error=>exitError=error);
 const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();let id=0;const responses=[];
 async function request(method,fields={}) {
  const key=++id;child.stdin.write(JSON.stringify({version:1,id:key,method,...fields})+'\n');
  const line=await lines.next();if(line.done)throw Error(exitError?.message||stderr||'Adapter exited before replying');
  const result=JSON.parse(line.value);if(result.id!==key||result.status!=='ok')throw Error(JSON.stringify(result));responses.push(result);return result;
 }
 const description=await request('describe');state.backend=description.description.backend;
 if(linux){const status=await readFile('/proc/'+child.pid+'/status','utf8');const affinity=status.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1].trim();if(affinity!==String(template.cpu))throw Error('Measurement affinity differs');state.affinity=affinity;}else state.affinity='macOS foreground policy; hard CPU pinning unverified';
 for(const original of workloads){const workload=structuredClone(original);workload.args=workload.args.map(String);
  const prepare=profile=>request('prepare',{prepare:{profile,workload,artifact:workload.artifact,artifact_sha256:workload.sha256}});
  let nativeCode=null;
  if(description.description.capabilities.can_code_profile||description.description.capabilities.can_measure_native_code_size||description.description.capabilities.can_export_native_code){await prepare('code');const inspect=await request('inspect');nativeCode=inspect.diagnostics.find(d=>d.metric==='native.code_size');if(nativeCode?.status!=='available'||!Number.isFinite(nativeCode.value)||nativeCode.value<=0)throw Error('Native-code size missing');}
  await prepare('timing');const phases={};
  const coreUsage={};
  const usage=()=>JSON.parse(runNative(join(root,'core-usage/darwin-core-usage'),[String(child.pid)],{timeout:3000}).toString());
  for(const phase of ['compile','instantiate','first-call','steady']){
   const before=checkCore?usage():null;
   const result=await request('run',{run:{scenario:phase,samples:12,operations:1,warmup:0}});
   const after=checkCore?usage():null;
   if(result.samples?.length!==12||result.samples.some(s=>!s.verified||s.warmup))throw Error('Twelve verified samples required');phases[phase]=12;
   if(checkCore){
    const delta=Object.fromEntries(['userTime','systemTime','performanceUserTime','performanceSystemTime','instructions','performanceInstructions'].map(key=>[key,after[key]-before[key]]));
    if(Object.values(delta).some(value=>!Number.isSafeInteger(value)||value<0))throw Error('Invalid CPU-class counter delta');
    const total=delta.userTime+delta.systemTime,performance=delta.performanceUserTime+delta.performanceSystemTime;
    coreUsage[phase]={...delta,performanceShare:total?performance/total:null,scope:'Adapter process during verified batch; physical CPU identity and compiler descendants are not covered'};
    (state.coreChecks??=[]).push({workload:workload.id,phase,...coreUsage[phase]});await save();
    if(!total||performance!==total)throw Error('Measured SDK batch did not execute exclusively on performance cores: '+JSON.stringify(coreUsage[phase]));
   }
  }
  (state.workloads??=[]).push({id:workload.id,phases,nativeCode,...(checkCore?{coreUsage}:{})});await save();
 }
 await request('close');await writeFile(join(directory,checkCore?'core-qualification.json':'sdk-qualification.json'),JSON.stringify({description:description.description,workloads:state.workloads,responses,scope:checkCore?'Per-batch adapter CPU-class qualification; does not prove fixed physical CPU affinity or compiler descendants':'Protocol/correctness qualification only; separate from published performance captures'},null,2)+'\n');
 state.status='qualified';state.completed=new Date().toISOString();await save();console.log(JSON.stringify({configuration:state.configuration,status:state.status,workloads:state.workloads}));
} catch(error){state.status='failed';state.reason=String(error);await save();throw error;}
finally {child?.kill('SIGTERM');await release();}
