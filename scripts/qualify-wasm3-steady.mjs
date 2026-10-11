// Private correctness proof; never imports measurements or mutates a live SDK.
import {readFile,mkdir,cp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {applyWasm3Sampling} from './lib/wasm3-sampling.mjs';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
const [campaignArg,sdkArg]=process.argv.slice(2),campaign=resolve(campaignArg),sdk=resolve(sdkArg);
const proof=join(campaign,'wasm3-steady-proof');await mkdir(proof,{recursive:true});
const receipt=JSON.parse(await readFile(join(sdk,'wasm3-build.json'))),suite=JSON.parse(await readFile(join(sdk,'suite.json'))),template=JSON.parse(await readFile(join(campaign,'collection-template.json')));
const workload=structuredClone(suite.find(w=>w.id==='applications/numeric-euclidean-gcd'));
if(!workload)throw Error('Required source-bound qualification corpus missing');
workload.reset='fresh_instance_per_sample';workload.args=workload.args.map(String);
const state={status:'waiting-lock',startedAt:new Date().toISOString(),source:receipt.runtime.command[0],databasePublished:false};
const save=()=>atomicJSON(join(proof,'status.json'),state);await save();
const release=await acquireMeasurementLock(join(campaign,'measurement-lock'));
async function check(command,patched){
 const child=spawn('taskset',['--cpu-list',String(template.cpu),...command],{cwd:receipt.root,env:{...process.env,...template.env,...receipt.env,WASMBENCH_SINGLE_CORE:'1',GOMAXPROCS:'1'},stdio:['pipe','pipe','pipe'],detached:true});
 const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},300000);let stderr='';child.stderr.on('data',d=>stderr=(stderr+d).slice(-8192));
 const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();let id=0;const responses=[];
 const request=async(method,fields={})=>{child.stdin.write(JSON.stringify({version:1,id:++id,method,...fields})+'\n');const l=await lines.next();if(l.done)throw Error(stderr||'SDK closed');const r=JSON.parse(l.value);if(r.id!==id)throw Error('Response identity changed');responses.push(r);return r};
 try{
  const description=await request('describe');if(description.status!=='ok')throw Error(JSON.stringify(description));
  const prepare=await request('prepare',{prepare:{profile:'timing',workload,artifact:workload.artifact,artifact_sha256:workload.sha256}});if(prepare.status!=='ok')throw Error(JSON.stringify(prepare));
  for(const phase of patched?['compile','first-call','steady']:['steady']){
   const r=await request('run',{run:{scenario:phase,samples:phase==='steady'?2:1,operations:1,warmup:0}});
   if(!patched){if(r.status==='ok'||!String(r.reason).includes('steady requires stateless reset'))throw Error('Baseline did not reproduce reset-policy rejection: '+JSON.stringify(r));}
   else if(r.status!=='ok'||r.samples?.length!==(phase==='steady'?2:1)||r.samples.some(s=>!s.verified||s.warmup))throw Error('Patched phase failed: '+JSON.stringify(r));
  }
  await request('close');await atomicJSON(join(proof,patched?'patched.json':'baseline.json'),{responses,affinity:template.cpu,scope:'Correctness-only; ordered fresh-state samples; no database capture'});
 }finally{clearTimeout(timer);try{process.kill(-child.pid,'SIGKILL')}catch{}}
}
try{
 await runCommand(process.execPath,['--test',join(import.meta.dirname,'wasm3-sampling.test.mjs')],{cwd:receipt.root,env:{...process.env,WASMFYI_NATIVE_ADAPTER_SOURCE:join(receipt.root,'adapters/native/src/main.rs')},log:join(proof,'source-test.log')});
 state.status='baseline';await save();await check(receipt.runtime.command,false);
 const root=join(proof,'harness'),native=join(root,'adapters/native');await mkdir(join(root,'adapters'),{recursive:true});
 await cp(join(receipt.root,'adapters/native'),native,{recursive:true,filter:source=>!source.split('/').includes('target')&&!source.split('/').includes('.git')});
 await applyWasm3Sampling(root);state.status='building';await save();
 const env={...process.env,...template.env,...receipt.env,CARGO_BUILD_JOBS:String(template.env.WASMFYI_BUILD_JOBS||8)};
 await runCommand('cargo',['build','--release','--locked','--no-default-features','--features','wasm3','--target-dir',join(proof,'target')],{cwd:native,env,log:join(proof,'build.log')});
 state.status='qualifying';await save();await check([join(proof,'target/release/adapter-native')],true);
 state.status='qualified';state.completedAt=new Date().toISOString();await save();
}catch(error){state.status='failed';state.reason=String(error);await save();throw error}
finally{await release()}
