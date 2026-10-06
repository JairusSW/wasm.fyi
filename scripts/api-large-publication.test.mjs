import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {runCommand} from './lib/benchmark-process.mjs';
import {digest} from './lib/wasmbench.mjs';
import {planIdentity} from './lib/benchmark-plan.mjs';
import {publishCompletedJob} from './lib/api-publish.mjs';

const site=fileURLToPath(new URL('..',import.meta.url));
test('large indexed corpus publication resumes without retransmitting and preserves portable reads',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-large-publication-'));let child,exit;
 try {
  const binary=process.env.WASMFYI_SERVICE_BINARY??join(root,'wasmfyi');
  if(!process.env.WASMFYI_SERVICE_BINARY)await runCommand('go',['build','-o',binary,'./cmd/wasmfyi'],{cwd:join(site,'service')});
  const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
  const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const token='large-publication-fixture-'+ 'x'.repeat(32),url=`http://127.0.0.1:${port}`,data=join(root,'store');
  const start=async(directory)=>{
   child=spawn(binary,['serve','--listen',`127.0.0.1:${port}`,'--data',directory],{env:{...process.env,WASMFYI_ADMIN_TOKEN:token},stdio:'ignore'});
   exit=new Promise(r=>child.once('exit',r));
   for(let i=0;i<400;i++){
    if(child.exitCode!==null)throw Error('Service exited before readiness');
    try{if((await fetch(url+'/api/v1/manifest')).ok)return}catch{}
    await new Promise(r=>setTimeout(r,25));
   }
   throw Error('Service readiness timed out');
  };
  const stop=async()=>{child.kill('SIGTERM');assert.equal(await exit,0);child=undefined};
  await start(data);
  const local=join(root,'local'),path='jobs/corpus-0001/exports/report/site-v2',directory=join(local,path);
  await mkdir(directory,{recursive:true});
  await cp(process.env.WASMFYI_LARGE_TRIAL_FIXTURE??join(site,'service/testdata/site-v2'),directory,{recursive:true});
  if(!process.env.WASMFYI_LARGE_TRIAL_FIXTURE){
   const manifest=JSON.parse(await readFile(join(directory,'manifest.json'))),objects=manifest.objects;
   const add=async(value)=>{const b=Buffer.from(JSON.stringify(value)),sha256=digest(b);await writeFile(join(directory,'objects',sha256),b);objects.push({sha256,bytes:b.length,kind:'evidence'});return sha256};
   const refs=[];for(let i=0;i<4500;i++)refs.push(await add({kind:'trial',schema:1,trialId:`synthetic-${i}`,data:{status:'ok'}}));
   let level=refs;while(level.length>1){const next=[];for(let i=0;i<level.length;i+=128)next.push(await add({kind:'evidence-index',schema:1,references:level.slice(i,i+128)}));level=next}
   for(let i=0;i<objects.length;i++){
    const o=objects[i];if(o.kind!=='record')continue;
    const record=JSON.parse(await readFile(join(directory,'objects',o.sha256)));if(record.kind!=='result'||record.data.metric!=='time.wall')continue;
    record.data.evidence=[level[0]];record.id=digest(Buffer.from(JSON.stringify(record.data)));
    const b=Buffer.from(JSON.stringify(record)),sha256=digest(b);await writeFile(join(directory,'objects',sha256),b);objects[i]={sha256,bytes:b.length,kind:'record'};
   }
   manifest.objects=[];manifest.inventoryPages=[];
   for(let i=0;i<objects.length;i+=512){const entries=objects.slice(i,i+512),b=Buffer.from(JSON.stringify({schema:1,objects:entries})),sha256=digest(b);await writeFile(join(directory,'objects',sha256),b);manifest.inventoryPages.push({sha256,bytes:b.length,objects:entries.length,contentBytes:entries.reduce((sum,o)=>sum+o.bytes,0)})}
   await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest));
  }
  const plan={schema:1,id:'large-publication',machines:[{name:'isolated'}],jobs:[{id:'corpus-0001'}],configuredHarnessPin:'0509a0a323f41c58a2f2db15a372fb2e63c692bf'};plan.identity=planIdentity(plan);
  const bundle=join(local,'bundle');await mkdir(bundle);
  const archive=Buffer.from('synthetic archived tools'),metadata=Buffer.from(JSON.stringify({planSha256:plan.identity}));
  await writeFile(join(bundle,'metadata.json'),metadata);await writeFile(join(bundle,'bundle.tar.gz.part-000'),archive);
  await writeFile(join(bundle,'index.json'),JSON.stringify({schema:1,id:plan.id,machine:'isolated',metadata:'metadata.json',metadataSha256:digest(metadata),bytes:archive.length,sha256:digest(archive),parts:[{path:'bundle.tar.gz.part-000',bytes:archive.length,sha256:digest(archive)}]}));
  const result={corpus:'corpus-0001',plan:plan.identity,siteExports:[path],finished:'2026-10-06T00:00:00Z',verdict:'FAIL'};
  const controller=new AbortController(),uploads=new Map();let interrupted=false;
  const request=async(target,options)=>{
   if(!interrupted&&uploads.size>=80){interrupted=true;controller.abort()}
   const response=await fetch(target,options);
   if(response.status===429)return response;
   assert(response.ok,`Publication HTTP ${response.status}: ${await response.clone().text()}`);
   if(options.method==='PUT')uploads.set(target,(uploads.get(target)??0)+1);
   return response;
  };
  const args={url,local,plan,machine:'isolated',result,token,request};
  const preflight=new AbortController(),cancelReason=new Error('cancel large export preflight');let preflightRequests=0;
  const cancelled=publishCompletedJob({...args,signal:preflight.signal,request:async()=>{preflightRequests++;throw Error('Cancelled preflight reached API')}});
  preflight.abort(cancelReason);await assert.rejects(cancelled,e=>e===cancelReason);assert.equal(preflightRequests,0);
  await assert.rejects(publishCompletedJob({...args,signal:controller.signal}),error=>{assert(interrupted,`Publication failed before intended interruption: ${error.stack}`);return true});
  assert.equal((await(await fetch(url+'/api/v1/manifest')).json()).revision,'');
  const retryCancel=new AbortController();let retryCalls=0;
  await assert.rejects(publishCompletedJob({...args,signal:retryCancel.signal,request:async()=>{
   retryCalls++;retryCancel.abort(new Error('cancel publisher backoff'));
   return new Response('',{status:429,headers:{'Retry-After':'1'}});
  }}),error=>error.name==='AbortError'||error.message==='cancel publisher backoff');assert.equal(retryCalls,1,'Cancellation retried publication');
  for(const retry of [null,'0','31','tomorrow']){
   await assert.rejects(publishCompletedJob({...args,request:async()=>new Response('',{status:429,headers:retry?{'Retry-After':retry}:{}})}),/Invalid API publication retry delay/);
  }
  const revision=await publishCompletedJob(args);assert.match(revision,/^[a-f0-9]{64}$/);
  for(const count of uploads.values())assert.equal(count,1,'Resume retransmitted installed content');
  const count=uploads.size;assert.equal(await publishCompletedJob(args),revision);assert.equal(uploads.size,count);
  for(const count of uploads.values())assert.equal(count,1,'Duplicate publication retransmitted installed content');
  let frozen;
  const check=async()=>{
   const response=await fetch(url+'/api/v1/results?revision='+revision);assert(response.ok);const page=await response.json();assert.equal(page.items.length,3);
   if(frozen)assert.deepEqual(page,frozen);else frozen=page;
   const timing=page.items.find(r=>r.data.metric==='time.wall');assert(timing);
   const base=url+'/api/v1/results/'+timing.id+'/samples?revision='+revision;
   const roots=await(await fetch(base)).json();assert.equal(roots.chunks.length,1);
   for(const last of [false,true]){
    let hash=roots.chunks[0];let steps=0;
    while(true){
     assert(++steps<8,'Unbounded evidence index depth');
     const response=await fetch(base+'&chunk='+hash);assert(response.ok,`Selected evidence HTTP ${response.status}`);
     const value=await response.json();assert.deepEqual(value,JSON.parse(await readFile(join(directory,'objects',hash))));
     if(value.kind!=='evidence-index'){assert(value.trialId);break}
     assert(value.references.length>0&&value.references.length<=128);
     const candidates=last?[...value.references].reverse():value.references;let selected;
     for(const candidate of candidates){const local=JSON.parse(await readFile(join(directory,'objects',candidate)));if(local.kind==='evidence-index'||local.trialId){selected=candidate;break}}
     assert(selected,'Index page has no selected trial');hash=selected;
    }
   }
   const progress=await(await fetch(url+'/api/v1/sessions/'+plan.id+'?revision='+revision)).json();assert.equal(progress.publishedCorpusJobs,1);assert.equal(progress.collectionComplete,true);
  };
  await check();await stop();await start(data);await check();await stop();
  const backup=join(root,'backup'),rebuilt=join(root,'rebuilt');
  await runCommand(binary,['backup','--data',data,'--output',backup]);await runCommand(binary,['verify-backup','--data',backup]);
  await runCommand(binary,['rebuild','--data',backup,'--output',rebuilt]);await start(rebuilt);await check();await stop();
 }finally{if(child){child.kill('SIGTERM');await exit}await rm(root,{recursive:true,force:true})}
});
