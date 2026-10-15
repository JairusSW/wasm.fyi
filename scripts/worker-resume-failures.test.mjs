import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {digest} from './lib/wasmbench.mjs';
import {workloadContract} from './lib/workload-contract.mjs';
import {historyIntegrationFailure} from './lib/history-completion-audit.mjs';

async function resume(statuses,note,retainRecordedSamples=false){
 const root=await mkdtemp(join(tmpdir(),'worker-resume-'));
 try{
  const directory=join(root,'job'),output=join(root,'captures'),cache=join(root,'.wasmbench/corpus-cache');
  for(const path of [directory,output,cache])await mkdir(path,{recursive:true});
  const bytes=Buffer.from('0061736d01000000','hex'),sha=digest(bytes);
  const workload={id:'fixture/tiny',artifact:'tiny.wasm',sha256:sha,abi:'core',export:'add',args:[],oracle:{expected:['12']},reset:'fresh_instance_per_sample'};
  await writeFile(join(cache,'tiny.wasm'),bytes);await writeFile(join(cache,'manifest.json'),JSON.stringify({schema:1,workloads:[workload]}));
  const source={repository:'fixture/fixture',revision:'a'.repeat(40),ref:'fixture',asOf:'2026-10-09T00:00:00Z',kind:'snapshot'};
  const controller=join(root,'never-launch-controller'),marker=join(root,'sdk-launched');
  await writeFile(controller,'#!/bin/sh\ntouch '+marker+'\nexit 99\n',{mode:0o755});
  const job={id:'fixture',engine:'fixture',controller,harness:root,source};
  const plan={corpusRoot:root,captureDirectory:output,machine:'fixture',platformSpecs:{cores:1,memoryBytes:1},workloads:[{id:workload.id,sha256:sha}],collection:{samples:1,adaptiveSampling:false},jobs:[job]};
  if(retainRecordedSamples){job.historical=true;plan.anchor='2026-10-15T00:00:00Z';plan.cutoff='2026-10-01T00:00:00Z';Object.assign(plan.collection,{samples:5,adaptiveSampling:{groupSize:5},retainRecordedSamples:true});}
  await writeFile(join(directory,'plan.json'),JSON.stringify(plan));
  const phases=['compile','instantiate','first-call','steady'];
  const capture={capturedAt:'2026-10-09T01:00:00Z',source,results:phases.map((phase,i)=>({workload:workload.id,phase,engine:'fixture',version:source.revision,artifactSha256:sha,contractSha256:workloadContract(workload),latencyStatus:statuses[i],timingSamples:statuses[i]==='ok'?1:0,latencyNs:statuses[i]==='ok'?1:null}))};
  if(retainRecordedSamples)for(const row of capture.results)if(row.latencyStatus==='ok')Object.assign(row,{timingSamples:3,samplesNs:[1,2,3]});
  const key=job.id+'-'+digest(Buffer.from(workload.id)).slice(0,16),file=join(output,key+'.json'),original=JSON.stringify(capture);
  await writeFile(file,original);
  if(note){await mkdir(join(directory,'failure-notes'));await writeFile(join(directory,'failure-notes',key+'.json'),JSON.stringify({capturedAt:capture.capturedAt,source,engine:'fixture',workload:workload.id,kind:'failed-trials',...note}));}
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[new URL('./benchmark-history-worker.mjs',import.meta.url).pathname,directory],{env:{...process.env,WASMBENCH_SHARED_DEVICE_RESERVED:'1',WASMBENCH_SHARED_DEVICE_SCHEDULE:join(root,'schedule.json')},stdio:['ignore','pipe','pipe']});
   let stderr='';child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('close',code=>resolve({code,stderr}));
  });
  assert.equal(result.code,0,result.stderr);assert.equal(await readFile(file,'utf8'),original,'A resume must retain the capture bytes');
  await assert.rejects(stat(marker),/ENOENT/,'A reused capture must never launch the SDK');
  return JSON.parse(await readFile(join(directory,'status.json')));
 }finally{await rm(root,{recursive:true,force:true});}
}
test('historical worker keeps imported legacy vectors byte-for-byte without launching a controller',{timeout:10000},async()=>{
 const status=await resume(['ok','ok','ok','ok'],null,true);
 assert.equal(status.status,'completed');assert.equal(status.completed,1);assert.deepEqual(status.errors,[]);
});
test('resumed worker keeps an earlier integration failure visible without running its capture again',{timeout:10000},async()=>{
 const status=await resume(['failed','failed','failed','failed'],{reason:'Invalid request JSON',failures:[{phase:'compile',reason:'Invalid request JSON'}]});
 assert.equal(status.status,'completed-with-errors');assert.equal(status.completed,1);assert.equal(status.errors.length,1);assert(historyIntegrationFailure(status.errors[0]));
});
test('resumed worker keeps only the residual failure after phase repair',{timeout:10000},async()=>{
 const status=await resume(['ok','ok','ok','failed'],{reason:'Invalid request JSON; Independent scalar oracle mismatch',failures:[{phase:'compile',reason:'Invalid request JSON'},{phase:'steady',reason:'Independent scalar oracle mismatch'}]});
 assert.equal(status.status,'completed-with-errors');assert.equal(status.errors.length,1);assert.equal(status.errors[0].error,'Independent scalar oracle mismatch');assert.deepEqual(status.errors[0].phases,['steady']);assert.equal(historyIntegrationFailure(status.errors[0]),false);
});
for(const outcome of ['ok','unsupported'])test('resumed worker ignores a stale failure note after all phases become '+outcome,{timeout:10000},async()=>{
 const status=await resume([outcome,outcome,outcome,outcome],{reason:'Invalid request JSON'});assert.equal(status.status,'completed');assert.deepEqual(status.errors,[]);
});
test('resumed worker holds the integration audit when a failed capture has lost its note',{timeout:10000},async()=>{
 const status=await resume(['failed','failed','failed','failed'],null);assert.equal(status.status,'completed-with-errors');assert.equal(status.errors.length,1);assert.match(status.errors[0].error,/Missing resumed failure note/);assert(historyIntegrationFailure(status.errors[0]));
});
test('resumed worker rejects a failure note from a different source',{timeout:10000},async()=>{
 const status=await resume(['failed','failed','failed','failed'],{source:{revision:'b'.repeat(40),asOf:'2026-10-09T00:00:00Z'},reason:'A genuine timeout'});
 assert.match(status.errors[0].error,/Missing resumed failure note/);assert(historyIntegrationFailure(status.errors[0]));
});
test('resumed worker retains a genuine bounded timeout without holding integration',{timeout:10000},async()=>{
 const status=await resume(['failed','failed','failed','failed'],{kind:'timeout',budgetMs:300000,reason:'Workload exceeded 300000ms'});
 assert.equal(status.errors[0].budgetMs,300000);assert.equal(historyIntegrationFailure(status.errors[0]),false);
});
test('resumed worker holds missing residual phase details',{timeout:10000},async()=>{
 const status=await resume(['ok','ok','ok','failed'],{reason:'Old compilation error',failures:[{phase:'compile',reason:'Old compilation error'}]});
 assert.match(status.errors[0].error,/Missing resumed failure details/);assert(historyIntegrationFailure(status.errors[0]));
});
