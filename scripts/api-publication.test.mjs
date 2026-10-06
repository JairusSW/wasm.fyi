import {ProgressDelivery} from './lib/api-progress-delivery.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {runCommand} from './lib/benchmark-process.mjs';
import {digest} from './lib/wasmbench.mjs';
import {publicationURL,publishCompletedJob,registerSessionPlan,publishAttemptProgress,readAttemptProgress} from './lib/api-publish.mjs';
import {planIdentity} from './lib/benchmark-plan.mjs';
const site=fileURLToPath(new URL('..',import.meta.url));
test('API origin requires HTTPS except loopback and excludes embedded secrets',()=>{
 assert.equal(publicationURL('https://wasm.fyi/'),'https://wasm.fyi');
 assert.equal(publicationURL('http://127.0.0.1:8090'),'http://127.0.0.1:8090');
 for(const u of ['http://other.test','https://u:p@wasm.fyi','https://wasm.fyi?token=x','https://wasm.fyi/api'])assert.throws(()=>publicationURL(u));
});
test('completed corpus uploads only missing objects, publishes idempotently, retains failures',async(t)=>{
 const timeouts=[]; const realTimeout=AbortSignal.timeout.bind(AbortSignal);
 t.mock.method(AbortSignal,'timeout',milliseconds=>{timeouts.push(milliseconds);return realTimeout(milliseconds)});
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-api-'));let child;let exit;
 try{
  const binary=join(root,'wasmfyi');await runCommand('go',['build','-o',binary,'./cmd/wasmfyi'],{cwd:join(site,'service')});
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const token='fixture-token-'+ 'x'.repeat(32);child=spawn(binary,['--listen',`127.0.0.1:${port}`,'--data',join(root,'store')],{env:{...process.env,WASMFYI_ADMIN_TOKEN:token},stdio:'ignore'});exit=new Promise(r=>child.once('exit',r));const url=`http://127.0.0.1:${port}`;
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Service exited during startup');try{const r=await fetch(url+'/api/v1/manifest');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,25))};assert(ready,'Service readiness timed out');
  const local=join(root,'local');const path='jobs/corpus-0001/exports/report/site-v2';await mkdir(join(local,path),{recursive:true});await cp(join(site,'service/testdata/site-v2'),join(local,path),{recursive:true});await mkdir(join(local,'bundle'));
  const plan={schema:1,id:'fixture-session',machines:[{name:'fixture-machine'}],jobs:[{id:'corpus-0001'},{id:'corpus-0002'}],configuredHarnessPin:'0509a0a323f41c58a2f2db15a372fb2e63c692bf'};plan.identity=planIdentity(plan);
  const parentBytes=Buffer.from('synthetic parent archive'),parentMetadata=Buffer.from(JSON.stringify({planSha256:plan.identity}));await writeFile(join(local,'bundle/metadata.json'),parentMetadata);await writeFile(join(local,'bundle/bundle.tar.gz.part-000'),parentBytes);await writeFile(join(local,'bundle/index.json'),JSON.stringify({schema:1,id:plan.id,machine:'fixture-machine',metadata:'metadata.json',metadataSha256:digest(parentMetadata),bytes:parentBytes.length,sha256:digest(parentBytes),parts:[{path:'bundle.tar.gz.part-000',bytes:parentBytes.length,sha256:digest(parentBytes)}]}));
  const result={corpus:'corpus-0001',plan:plan.identity,siteExports:[path],finished:'2026-10-05T00:00:00Z',verdict:'FAIL'};
  const resourceDirectory=join(local,path),resourceManifest=JSON.parse(await readFile(join(resourceDirectory,'manifest.json'))),resourcePayload=resourceManifest.objects;
  const original=Buffer.from(JSON.stringify({kind:'pass-context',manifest:{id:'source-pass',lock:{options:{suite:'diagnostic '.repeat(45000)}}}})),references=[];
  for(let start=0;start<original.length;start+=120*1024){
    const b=Buffer.from(JSON.stringify({kind:'json-fragment',schema:1,text:original.subarray(start,start+120*1024).toString('utf8')})),sha256=digest(b);
    await writeFile(join(resourceDirectory,'objects',sha256),b);resourcePayload.push({sha256,bytes:b.length,kind:'evidence'});references.push(sha256);
  }
  const resource=Buffer.from(JSON.stringify({kind:'json-resource',schema:1,encoding:'json-utf8',bytes:original.length,sha256:digest(original),references})),resourceHash=digest(resource);
  await writeFile(join(resourceDirectory,'objects',resourceHash),resource);resourcePayload.push({sha256:resourceHash,bytes:resource.length,kind:'evidence'});
  for(let i=0;i<resourcePayload.length;i++){
    const o=resourcePayload[i];if(o.kind!=='record')continue;const record=JSON.parse(await readFile(join(resourceDirectory,'objects',o.sha256)));if(record.kind!=='report')continue;
    record.data.passContexts=[resourceHash];const b=Buffer.from(JSON.stringify(record)),sha256=digest(b);
    await writeFile(join(resourceDirectory,'objects',sha256),b);resourcePayload[i]={sha256,bytes:b.length,kind:'record'};
  }
  await writeFile(join(resourceDirectory,'manifest.json'),JSON.stringify(resourceManifest));
  let uploads=0,rateLimited=false;const request=async(url,options)=>{if(!rateLimited&&options.method==='PUT'){rateLimited=true;return new Response('',{status:429,headers:{'Retry-After':'1'}})}const response=await fetch(url,options);if(response.status===429)return response;assert(response.ok,`Unexpected API failure: ${response.status} ${await response.clone().text()}`);if(options.method==='PUT')uploads++;return response};
  const historyManifest=JSON.parse(await readFile(join(local,path,'manifest.json')));
  const configurationObject=await Promise.all(historyManifest.objects.filter(o=>o.kind==='record').map(async o=>JSON.parse(await readFile(join(local,path,'objects',o.sha256)))));
  const configurationId=configurationObject.find(r=>r.kind==='configuration').id;
  const historyBindings=[{reportId:historyManifest.reportId,configurationId,policy:'declared-build-history-v1',targetDates:['2026-01-03','2026-01-10'],buildRole:'source'}];
  result.historyBindings=historyBindings;
  const args={url,local,plan,machine:'fixture-machine',result,token,request};
  const collectionURL=url+'/api/v1/collection/sessions/'+plan.id;
  assert.equal((await fetch(collectionURL)).status,404,'Unregistered session visible');
  const registered=await registerSessionPlan({url,plan,token,request});assert.match(registered,/^[a-f0-9]{64}$/);
  assert(rateLimited,'Publisher fixture did not exercise rate-limit retry');
  const registeredScope=await(await fetch(collectionURL)).json();assert.equal(registeredScope.plannedJobs,2);assert.equal(registeredScope.members,1);assert.equal(registeredScope.status,'registered');
  assert.equal((await(await fetch(url+'/api/v1/manifest')).json()).revision,'','Registration published measurement revision');
  const update={schema:1,session:plan.id,plan:plan.identity,machine:'fixture-machine',corpus:'corpus-0001',attempt:'live-attempt',sequence:1,status:'running',phase:'timing',observedAt:'2026-10-06T00:00:00Z'};
  const liveProgress=await publishAttemptProgress({url,update,token});assert.equal(liveProgress.update.status,'running');
  assert.deepEqual(await publishAttemptProgress({url,update,token}),liveProgress,'Progress retry changed receipt');
  const progressURL=collectionURL+'/attempts/fixture-machine/corpus-0001/live-attempt';
  assert.deepEqual(await(await fetch(progressURL)).json(),liveProgress);
  await assert.rejects(publishAttemptProgress({url,update:{...update,sequence:3},token}),/409/);
  await publishAttemptProgress({url,update:{...update,sequence:2,status:'interrupted'},token});
  await assert.rejects(publishAttemptProgress({url,update:{...update,sequence:3},token}),/409/);
  assert.equal((await fetch(collectionURL+'?revision='+ 'a'.repeat(64))).status,400,'Live registration accepted immutable revision scope');
  const journalArgs={directory:join(root,'progress-journal'),plan,send:update=>publishAttemptProgress({url,update,token}),readState:update=>readAttemptProgress({url,update,token})};
  const delivery=new ProgressDelivery(journalArgs);const firstEvent=delivery.record({machine:'fixture-machine',corpus:'corpus-0001',status:'running',phase:'timing',time:'2026-10-06T00:00:00.000Z'});await delivery.flush();
  const recoveredDelivery=new ProgressDelivery({...journalArgs,send:async()=>{throw Error('Already confirmed event resent')}});await recoveredDelivery.replay();
  await new ProgressDelivery(journalArgs).interruptPrevious('fixture-machine');
  assert.equal((await readAttemptProgress({url,update:firstEvent,token})).update.status,'interrupted');
  assert.equal(await readAttemptProgress({url,update:{...firstEvent,attempt:'never-started'},token}),null);
  uploads=0;assert.equal(await registerSessionPlan({url,plan,token,request}),registered);assert.equal(uploads,0,'Registered duplicate retransferred source');
  const changed=structuredClone(plan);changed.jobs.push({id:'corpus-other'});changed.identity=planIdentity(changed);
  await assert.rejects(registerSessionPlan({url,plan:changed,token}),/409/);

  await assert.rejects(publishCompletedJob({...args,machine:'other-machine',request:async()=>{throw Error('Wrong parent reached API')}}),/outside session plan|another plan or machine/);
  const parentPath=join(local,'bundle/index.json'),savedParent=await readFile(parentPath),uncommittedParent=JSON.parse(savedParent);delete uncommittedParent.metadataSha256;await writeFile(parentPath,JSON.stringify(uncommittedParent));await assert.rejects(publishCompletedJob({...args,request:async()=>{throw Error('Uncommitted metadata reached API')}}),/metadata digest required/);await writeFile(parentPath,savedParent);
  const revision=await publishCompletedJob(args);
  assert(timeouts.includes(300000),'Commit lacks five-minute deadline');
  assert(timeouts.includes(30000),'Ordinary publication requests lost short deadline');
  assert.match(revision,/^[a-f0-9]{64}$/);assert(uploads>0);uploads=0;assert.equal(await publishCompletedJob(args),revision);assert.equal(uploads,0,'Duplicate transferred existing evidence');
  const manifest=await (await fetch(url+'/api/v1/manifest')).json();assert.equal(manifest.revision,revision);
  const publishedJobs=await(await fetch(url+'/api/v1/sessions/'+plan.id+'/jobs?revision='+revision)).json();
  const historyContext=await(await fetch(url+'/api/v1/history/jobs/'+publishedJobs.items[0].id+'?revision='+revision)).json();
  assert.equal(historyContext.total,1);assert.deepEqual(historyContext.items[0].binding,historyBindings[0]);assert.equal(historyContext.items[0].interpretationSource,'trusted-publisher-assertion');assert.equal(historyContext.items[0].collectionTimeSource,'source-report-created');
  const results=await (await fetch(url+'/api/v1/results?revision='+revision)).json();assert.equal(results.items.length,3);assert.equal(results.complete,true);
  const artifacts=await (await fetch(url+'/api/v1/artifacts?revision='+revision)).json();assert.equal(artifacts.items[0].data.measurementAvailable,true);assert.equal(artifacts.items[0].data.content.status,'unavailable');
  const pagedPath='jobs/corpus-0001/exports/paged/site-v2',pagedDirectory=join(local,pagedPath);
  await mkdir(pagedDirectory,{recursive:true});await cp(join(local,path),pagedDirectory,{recursive:true});
  const pagedManifest=JSON.parse(await readFile(join(pagedDirectory,'manifest.json'))),payload=pagedManifest.objects;
  for(let ordinal=0;ordinal<600;ordinal++){
    const b=Buffer.from(JSON.stringify({kind:'diagnostic',ordinal})),sha256=digest(b);
    await writeFile(join(pagedDirectory,'objects',sha256),b);payload.push({sha256,bytes:b.length,kind:'evidence'});
  }
  pagedManifest.objects=[];pagedManifest.inventoryPages=[];
  for(let start=0;start<payload.length;start+=512){
    const entries=payload.slice(start,start+512),b=Buffer.from(JSON.stringify({schema:1,objects:entries})),sha256=digest(b);
    await writeFile(join(pagedDirectory,'objects',sha256),b);
    pagedManifest.inventoryPages.push({sha256,bytes:b.length,objects:entries.length,contentBytes:entries.reduce((total,o)=>total+o.bytes,0)});
  }
  await writeFile(join(pagedDirectory,'manifest.json'),JSON.stringify(pagedManifest));
  const pagedArgs={...args,result:{...result,siteExports:[pagedPath]}};
  const pagedRevision=await publishCompletedJob(pagedArgs);assert.notEqual(pagedRevision,revision);
  uploads=0;assert.equal(await publishCompletedJob(pagedArgs),pagedRevision);assert.equal(uploads,0,'Paged duplicate uploaded existing content');
  const progress=await(await fetch(url+'/api/v1/sessions/'+plan.id+'?revision='+pagedRevision)).json();assert.equal(progress.plannedJobs,2);assert.equal(progress.publishedCorpusJobs,1);assert.equal(progress.publishedJobs,2);assert.equal(progress.collectionComplete,false);
  const history=await(await fetch(url+'/api/v1/history?revision='+pagedRevision)).json();assert.equal(history.items.length,3,'Repackaged evidence became new observations');
  const evidenceURL=url+'/api/v1/reports/'+pagedManifest.reportId+'/evidence?revision='+pagedRevision;
  const descriptor=await(await fetch(evidenceURL+'&chunk='+resourceHash)).json();assert.equal(descriptor.bytes,original.length);
  const firstFragment=await(await fetch(evidenceURL+'&chunk='+references[0])).json();assert.equal(firstFragment.kind,'json-fragment');assert(firstFragment.text.length<=120*1024);

  const binaryPath='jobs/corpus-0001/exports/binary/site-v2',binaryDirectory=join(local,binaryPath);
  await mkdir(binaryDirectory,{recursive:true});await cp(resourceDirectory,binaryDirectory,{recursive:true});
  const binaryManifest=JSON.parse(await readFile(join(binaryDirectory,'manifest.json'))),native=Buffer.alloc(1234,0x90),nativeHash=digest(native);
  await writeFile(join(binaryDirectory,'objects',nativeHash),native);binaryManifest.objects.push({sha256:nativeHash,bytes:native.length,kind:'binary'});
  let oldArtifact,newArtifact;
  for(let i=0;i<binaryManifest.objects.length;i++){
    const o=binaryManifest.objects[i];if(o.kind!=='record')continue;const record=JSON.parse(await readFile(join(binaryDirectory,'objects',o.sha256)));if(record.kind!=='artifact')continue;
    oldArtifact=record.id;record.data.content={status:'available',sha256:nativeHash,bytes:native.length,mediaType:'application/octet-stream'};
    record.id=digest(Buffer.from(JSON.stringify(record.data)));newArtifact=record.id;
    const b=Buffer.from(JSON.stringify(record)),sha256=digest(b);await writeFile(join(binaryDirectory,'objects',sha256),b);binaryManifest.objects[i]={sha256,bytes:b.length,kind:'record'};
  }
  for(let i=0;i<binaryManifest.objects.length;i++){
    const o=binaryManifest.objects[i];if(o.kind!=='record')continue;const record=JSON.parse(await readFile(join(binaryDirectory,'objects',o.sha256)));if(record.kind!=='result'||record.data.summary.artifactId!==oldArtifact)continue;
    record.data.summary.artifactId=newArtifact;record.id=digest(Buffer.from(JSON.stringify(record.data)));
    const b=Buffer.from(JSON.stringify(record)),sha256=digest(b);await writeFile(join(binaryDirectory,'objects',sha256),b);binaryManifest.objects[i]={sha256,bytes:b.length,kind:'record'};
  }
  await writeFile(join(binaryDirectory,'manifest.json'),JSON.stringify(binaryManifest));
  const binaryArgs={...args,result:{...result,siteExports:[binaryPath]}},binaryRevision=await publishCompletedJob(binaryArgs);
  const download=await fetch(url+'/api/v1/artifacts/'+newArtifact+'/bytes?revision='+binaryRevision+'&download=1');assert.equal(download.status,200);assert(Buffer.from(await download.arrayBuffer()).equals(native));
  const binaryHistory=await(await fetch(url+'/api/v1/history?revision='+binaryRevision)).json();assert.equal(binaryHistory.items.length,3,'Adding native bytes created independent observations');
  uploads=0;assert.equal(await publishCompletedJob(binaryArgs),binaryRevision);assert.equal(uploads,0);
  await assert.rejects(publishCompletedJob({...args,result:{...result,finished:null}}),/Incomplete/);
  const exportManifest=JSON.parse(await readFile(join(local,path,'manifest.json')));const object=exportManifest.objects[0];await writeFile(join(local,path,'objects',object.sha256),'tampered');await assert.rejects(publishCompletedJob(args),/differs/);
 }finally{if(child){child.kill('SIGTERM');await exit};await rm(root,{recursive:true,force:true})}
});
