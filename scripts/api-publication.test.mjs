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
import {publicationURL,publishCompletedJob} from './lib/api-publish.mjs';
const site=fileURLToPath(new URL('..',import.meta.url));
test('API origin requires HTTPS except loopback and excludes embedded secrets',()=>{
 assert.equal(publicationURL('https://wasm.fyi/'),'https://wasm.fyi');
 assert.equal(publicationURL('http://127.0.0.1:8090'),'http://127.0.0.1:8090');
 for(const u of ['http://other.test','https://u:p@wasm.fyi','https://wasm.fyi?token=x','https://wasm.fyi/api'])assert.throws(()=>publicationURL(u));
});
test('completed corpus uploads only missing objects, publishes idempotently, retains failures',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-api-'));let child;let exit;
 try{
  const binary=join(root,'wasmfyi');await runCommand('go',['build','-o',binary,'./cmd/wasmfyi'],{cwd:join(site,'service')});
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const token='fixture-token-'+ 'x'.repeat(32);child=spawn(binary,['--listen',`127.0.0.1:${port}`,'--data',join(root,'store')],{env:{...process.env,WASMFYI_ADMIN_TOKEN:token},stdio:'ignore'});exit=new Promise(r=>child.once('exit',r));const url=`http://127.0.0.1:${port}`;
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Service exited during startup');try{const r=await fetch(url+'/api/v1/manifest');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,25))};assert(ready,'Service readiness timed out');
  const local=join(root,'local');const path='jobs/corpus-0001/exports/report/site-v2';await mkdir(join(local,path),{recursive:true});await cp(join(site,'service/testdata/site-v2'),join(local,path),{recursive:true});await mkdir(join(local,'bundle'));await writeFile(join(local,'bundle/index.json'),'{}');
  const plan={id:'fixture-session',identity:digest(Buffer.from('plan')),configuredHarnessPin:'0509a0a323f41c58a2f2db15a372fb2e63c692bf'};
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
  let uploads=0;const request=async(url,options)=>{if(options.method==='PUT')uploads++;const response=await fetch(url,options);assert(response.ok,`Unexpected API failure: ${response.status} ${await response.clone().text()}`);return response};
  const args={url,local,plan,machine:'fixture-machine',result,token,request};
  const revision=await publishCompletedJob(args);assert.match(revision,/^[a-f0-9]{64}$/);assert(uploads>0);uploads=0;assert.equal(await publishCompletedJob(args),revision);assert.equal(uploads,0,'Duplicate transferred existing evidence');
  const manifest=await (await fetch(url+'/api/v1/manifest')).json();assert.equal(manifest.revision,revision);
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
