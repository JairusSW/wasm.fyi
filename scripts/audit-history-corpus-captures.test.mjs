import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('disabled latency cannot satisfy a measured corpus target while genuine unsupported outcomes can',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unmeasured-capture-audit-'));
 try{
  const hash='a'.repeat(64),revision='b'.repeat(40),date='2026-10-04T10:00:00.000Z';
  await mkdir(join(root,'captures'));
  await writeFile(join(root,'source-plan.json'),JSON.stringify({samples:5,pins:[{status:'planned',engine:'wago',configurations:['wago'],targetType:'main',revision,targetWeek:date,repository:'wago-org/wago'}]}));
  await writeFile(join(root,'collection-template.json'),JSON.stringify({machine:'test',collection:{samples:5},workloads:[{id:'applications/test',sha256:hash}]}));
  for(const latencyStatus of ['disabled','unsupported']){
   await writeFile(join(root,'captures/test.json'),JSON.stringify({platform:{memoryBytes:1024},source:{kind:'main',revision,asOf:date,repository:'wago-org/wago'},results:['compile','instantiate','first-call','steady'].map(phase=>({phase,engine:'wago',version:revision,workload:'applications/test',artifactSha256:hash,latencyStatus}))}));
   execFileSync(process.execPath,['scripts/audit-history-corpus-captures.mjs',root]);
   const audit=JSON.parse(await readFile(join(root,'corpus-capture-audit.json')));
   assert.equal(audit.machines[0].completeTargets,latencyStatus==='unsupported'?1:0);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('capture audit rejects startup failures without a qualified runtime version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'capture-audit-'));
 try{
 const hash='a'.repeat(64),revision='b'.repeat(40),date='2026-10-04T03:59:00.000Z';
 await mkdir(join(root,'captures'));
 await writeFile(join(root,'source-plan.json'),JSON.stringify({samples:5,pins:[{status:'planned',engine:'wasmedge',configurations:['wasmedge-jit'],targetType:'main',revision,targetWeek:date,repository:'WasmEdge/WasmEdge'}]}));
 await writeFile(join(root,'collection-template.json'),JSON.stringify({machine:'test',collection:{samples:5},workloads:[{id:'applications/test',sha256:hash}]}));
 await writeFile(join(root,'captures/test.json'),JSON.stringify({platform:{memoryBytes:1024},source:{kind:'main',revision,asOf:date,repository:'WasmEdge/WasmEdge'},results:['compile','instantiate','first-call','steady'].map(phase=>({phase,engine:'wasmedge-jit',version:'unknown',workload:'applications/test',artifactSha256:hash,latencyStatus:'failed'}))}));
 execFileSync(process.execPath,['scripts/audit-history-corpus-captures.mjs',root]);
 const audit=JSON.parse(await readFile(join(root,'corpus-capture-audit.json')));
 assert.equal(audit.machines[0].errors.length,1);
 assert.equal(audit.machines[0].completeTargets,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('adaptive audit accepts complete 5-sample launch groups from three to ten launches',async()=>{
 const root=await mkdtemp(join(tmpdir(),'adaptive-capture-audit-'));
 try{
  const hash='a'.repeat(64),revision='b'.repeat(40),date='2026-10-04T03:59:00.000Z';
  await mkdir(join(root,'captures'));
  await writeFile(join(root,'source-plan.json'),JSON.stringify({samples:5,pins:[{status:'planned',engine:'wago',configurations:['wago'],targetType:'main',revision,targetWeek:date,repository:'wago-org/wago'}]}));
  await writeFile(join(root,'collection-template.json'),JSON.stringify({machine:'test',collection:{samples:5,adaptiveSampling:{minLaunches:3,maxLaunches:10}},workloads:[{id:'applications/test',sha256:hash}]}));
  for(const n of [15,20,50,5,16,55]){
   await writeFile(join(root,'captures/test.json'),JSON.stringify({platform:{memoryBytes:1024},source:{kind:'main',revision,asOf:date,repository:'wago-org/wago'},results:['compile','instantiate','first-call','steady'].map(phase=>({phase,engine:'wago',version:revision,workload:'applications/test',artifactSha256:hash,latencyStatus:'ok',latencyNs:10,timingSamples:n,samplesNs:Array(n).fill(10),memoryStatus:'ok',peakRssBytes:1024,codeStatus:'ok',codeBytes:100}))}));
   execFileSync(process.execPath,['scripts/audit-history-corpus-captures.mjs',root]);
   const audit=JSON.parse(await readFile(join(root,'corpus-capture-audit.json')));
   assert.equal(audit.machines[0].errors.length,[15,20,50].includes(n)?0:1);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('same-process default audits groups of five through 35 samples and JVM code n/a',async()=>{
 const root=await mkdtemp(join(tmpdir(),'same-process-audit-'));
 try{
  const hash='a'.repeat(64),revision='b'.repeat(40),date='2026-10-04T10:00:00.000Z';
  await mkdir(join(root,'captures'));
  await writeFile(join(root,'source-plan.json'),JSON.stringify({samples:5,pins:[{status:'planned',engine:'chicory',configurations:['chicory-jit'],targetType:'main',revision,targetWeek:date,repository:'dylibso/chicory'}]}));
  await writeFile(join(root,'collection-template.json'),JSON.stringify({machine:'test',historyNotBefore:'2026-06-28',collection:{samples:5,adaptiveSampling:true},workloads:[{id:'applications/test',sha256:hash}]}));
  for(const n of [5,10,15,20,25,30,35,1,12,40]){
   await writeFile(join(root,'captures/test.json'),JSON.stringify({platform:{memoryBytes:1024},source:{kind:'main',revision,asOf:date,repository:'dylibso/chicory'},results:['compile','instantiate','first-call','steady'].map(phase=>({phase,engine:'chicory-jit',backend:'jvm-bytecode-compiler',version:revision,workload:'applications/test',artifactSha256:hash,latencyStatus:'ok',latencyNs:10,timingSamples:n,samplesNs:Array(n).fill(10),memoryStatus:'ok',peakRssBytes:1024,codeStatus:'unsupported',codeBytes:null}))}));
   execFileSync(process.execPath,['scripts/audit-history-corpus-captures.mjs',root]);
   const audit=JSON.parse(await readFile(join(root,'corpus-capture-audit.json')));
   const valid=n>=5&&n<=35&&n%5===0;
   assert.equal(audit.machines[0].errors.length,valid?0:1);
   assert.equal(audit.machines[0].completeTargets,valid?1:0);
   if(valid)assert.equal(audit.machines[0].resourceGaps.length,0);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
