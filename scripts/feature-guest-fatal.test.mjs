import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {retainedFeatureGuestFatal} from './lib/feature-guest-fatal.mjs';import {workloadContract} from './lib/workload-contract.mjs';import {historyIntegrationFailure} from './lib/history-completion-audit.mjs';
const key='a'.repeat(64),engine='wago',source={revision:'b'.repeat(40),asOf:'2026-10-09T00:00:00Z'},workload={id:'features/threads/test/1',sha256:'c'.repeat(64),abi:'core',export:'run',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
const reason='adapter terminated before response (see trial log)';
const log='SIGSEGV: segmentation violation\nPC=0x1234 m=0 sigcode=1 addr=0x8\n\ngithub.com/wago-org/wago/src/core/runtime.enterNative(0x1234)\ngithub.com/wago-org/wago/src/core/runtime.(*Engine).CallPrepared(0x1234)\n';
async function fixture(run){
 const root=await mkdtemp(join(tmpdir(),'feature-guest-fatal-')),producer=join(root,'compatibility',engine,key,'producer');
 const prior={capture:'original.json',source,failure:{kind:'failed-trials',engine,source,workload:workload.id,reason,failures:[{engine,workload:workload.id,phase:'first-call',status:'error',reason}]}};
 const manifest={host:{os:'linux',arch:'amd64',cpu_description:'Fixture',kernel:'test'},lock:{workloads:[workload],runtime_configurations:[{id:engine,description:{runtime_version:source.revision+'/source-pinned'}}]}};
 const capture={source,platform:{os:'linux',arch:'amd64',cpu:'Fixture',kernel:'test'},results:[{engine,workload:workload.id,artifactSha256:workload.sha256,contractSha256:workloadContract(workload),phase:'first-call',latencyStatus:'failed'}]};
 const write=async(path,data)=>{await mkdir(join(path,'..'),{recursive:true});await writeFile(path,typeof data==='string'?data:JSON.stringify(data));};
 await write(join(root,'captures',prior.capture),capture);await write(join(producer,'manifest.json'),manifest);
 await write(join(producer,'trials/trial.json'),{runtime_configuration:engine,workload:workload.id,scenario:'first-call',status:'error',reason,log:'logs/trial.log'});await write(join(producer,'logs/trial.log'),log);
 try{await run({root,producer,prior,manifest,capture,write});}finally{await rm(root,{recursive:true,force:true});}
}
test('retained exact-source guest crash is a failed runtime outcome with sealed evidence',()=>fixture(async({root,prior})=>{
 const result=await retainedFeatureGuestFatal({root,key,engine,workload,prior});assert(result);assert.equal(historyIntegrationFailure(result.failure),false);assert.equal(result.failure.originalReason,reason);assert.equal(prior.failure.reason,reason);assert.equal(result.evidence.sealedFiles.length,4);assert(result.evidence.sealedFiles.every(f=>f.sha256.length===64));
}));
test('mismatched source, artifact, contract, host, or absent native evidence stays pending',()=>fixture(async({root,producer,prior,manifest,capture,write})=>{
 for(const mutate of [m=>m.lock.workloads[0].sha256='d'.repeat(64),m=>m.lock.workloads[0].args=['2'],m=>m.lock.runtime_configurations[0].description.runtime_version='other',m=>m.host.cpu_description='Other']){
  const changed=structuredClone(manifest);mutate(changed);await write(join(producer,'manifest.json'),changed);assert.equal(await retainedFeatureGuestFatal({root,key,engine,workload,prior}),null);
 }
 await write(join(producer,'manifest.json'),manifest);await write(join(producer,'logs/trial.log'),'segmentation fault');assert.equal(await retainedFeatureGuestFatal({root,key,engine,workload,prior}),null);
 assert.equal(await retainedFeatureGuestFatal({root,key:'../outside',engine,workload,prior}),null);
}));
