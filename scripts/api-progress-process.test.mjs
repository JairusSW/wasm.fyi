import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {runCommand} from './lib/benchmark-process.mjs';
import {planIdentity} from './lib/benchmark-plan.mjs';
import {registerSessionPlan} from './lib/api-publish.mjs';
const site=fileURLToPath(new URL('..',import.meta.url));
const senderSource=`
import {ProgressDelivery} from ${JSON.stringify(new URL('./lib/api-progress-delivery.mjs',import.meta.url).href)};
import {publishAttemptProgress,readAttemptProgress} from ${JSON.stringify(new URL('./lib/api-publish.mjs',import.meta.url).href)};
const [directory,encoded,url,mode]=process.argv.slice(1),plan=JSON.parse(encoded);
const token=process.env.WASMFYI_ADMIN_TOKEN;
const delivery=new ProgressDelivery({directory,plan,readState:update=>readAttemptProgress({url,update,token}),send:async update=>{
 const receipt=await publishAttemptProgress({url,update,token});
 if(mode==='crash'){process.send({checkpoint:'committed-before-delivery-return',attempt:update.attempt});await new Promise(resolve=>setTimeout(resolve,30000))}
 return receipt;
}});
if(mode==='crash'){
 delivery.record({machine:'local',corpus:'corpus-0001',status:'running',phase:'timing',time:'2026-10-06T00:00:00.000Z'});await delivery.flush();
}else{
 await delivery.replay();await delivery.interruptPrevious('local');
 const first=delivery.record({machine:'local',corpus:'corpus-0001',status:'running',phase:'timing',time:'2026-10-06T01:00:00.000Z'});
 delivery.record({machine:'local',corpus:'corpus-0001',status:'completed',time:'2026-10-06T01:00:01.000Z'});await delivery.flush();
 process.send({checkpoint:'recovered-and-completed',attempt:first.attempt});
}
`;
function launched(program,args,options={}){
 const child=spawn(program,args,options);let stderr='';child.stderr?.on('data',b=>stderr=(stderr+b).slice(-4096));
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal,stderr}))});return {child,exit};
}
async function message(worker,checkpoint){
 let timer;const observed=new Promise((resolve,reject)=>{
  const onMessage=value=>{if(value.checkpoint===checkpoint){worker.child.off('message',onMessage);resolve(value)}};
  worker.child.on('message',onMessage);worker.exit.then(result=>{worker.child.off('message',onMessage);reject(Error('Sender exited before checkpoint: '+JSON.stringify(result)))},reject);
  timer=setTimeout(()=>{worker.child.off('message',onMessage);reject(Error('Progress checkpoint deadline'))},15000);timer.unref();
 });try{return await observed}finally{clearTimeout(timer)}
}
async function stop(worker,signal='SIGTERM'){
 if(!worker)return;let timer;
 if(worker.child.exitCode===null&&worker.child.signalCode===null){worker.child.kill(signal);timer=setTimeout(()=>worker.child.kill('SIGKILL'),10000);timer.unref()}
 try{return await worker.exit}finally{clearTimeout(timer)}
}

test('abrupt progress sender exit and service restart preserve one interrupted attempt and one resumed attempt',{timeout:90000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-progress-process-'));let serving,sender;
 try{
  const binary=join(root,'wasmfyi');await runCommand('go',['build','-o',binary,'./cmd/wasmfyi'],{cwd:join(site,'service'),env:{...process.env,GOFLAGS:'-mod=readonly',GOWORK:'off'}});
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const url='http://127.0.0.1:'+port,token='synthetic-progress-process-'+ 'x'.repeat(40),env={...process.env,WASMFYI_ADMIN_TOKEN:token};
  async function start(){serving=launched(binary,['serve','--listen','127.0.0.1:'+port,'--data',join(root,'store')],{env,stdio:['ignore','ignore','pipe']});for(let i=0;i<200;i++){if(serving.child.exitCode!==null)throw Error('Service exited during readiness');try{if((await fetch(url+'/readyz',{signal:AbortSignal.timeout(1000)})).ok)return}catch{}await new Promise(r=>setTimeout(r,25))};throw Error('Service readiness deadline')}
  await start();const plan={schema:1,id:'process-resume',configuredHarnessPin:'0509a0a323f41c58a2f2db15a372fb2e63c692bf',machines:[{name:'local'}],jobs:[{id:'corpus-0001'}]};plan.identity=planIdentity(plan);await registerSessionPlan({url,plan,token});
  const journal=join(root,'journal');sender=launched(process.execPath,['--input-type=module','-e',senderSource,journal,JSON.stringify(plan),url,'crash'],{env,stdio:['ignore','ignore','pipe','ipc']});
  const first=await message(sender,'committed-before-delivery-return');const killed=await stop(sender,'SIGKILL');assert.equal(killed.signal,'SIGKILL');sender=null;
  const scopeURL=url+'/api/v1/collection/sessions/'+plan.id+'/attempts';let page=await(await fetch(scopeURL)).json();assert.equal(page.total,1);assert.equal(page.items[0].update.sequence,1);assert.equal(page.items[0].update.status,'running');assert.equal(page.items[0].update.attempt,first.attempt);
  assert.equal((await stop(serving)).code,0);serving=null;await start();
  sender=launched(process.execPath,['--input-type=module','-e',senderSource,journal,JSON.stringify(plan),url,'resume'],{env,stdio:['ignore','ignore','pipe','ipc']});const resumed=await message(sender,'recovered-and-completed');const result=await sender.exit;assert.equal(result.code,0,result.stderr);sender=null;assert.notEqual(resumed.attempt,first.attempt);
  page=await(await fetch(scopeURL)).json();assert.equal(page.total,2);assert.equal(page.complete,true);
  const previous=page.items.find(item=>item.update.attempt===first.attempt),current=page.items.find(item=>item.update.attempt===resumed.attempt);
  assert.equal(previous.update.sequence,2);assert.equal(previous.update.status,'interrupted');assert.equal(previous.update.phase,'coordinator-restart');assert.equal(current.update.sequence,2);assert.equal(current.update.status,'completed');
  assert.equal((await(await fetch(url+'/api/v1/manifest')).json()).revision,'','Operational assertions manufactured a measurement revision');
 }finally{await stop(sender,'SIGKILL');await stop(serving);await rm(root,{recursive:true,force:true})}
});
