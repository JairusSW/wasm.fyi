import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {runCommand} from './lib/benchmark-process.mjs';
import {digest} from './lib/wasmbench.mjs';
import {exportConformanceArchive,publishConformanceExport} from './lib/conformance-api.mjs';
const site=fileURLToPath(new URL('..',import.meta.url));
function capture(){return {schema:1,host:{hostname:'synthetic',os:'darwin',arch:'arm64'},created:'2026-10-06T21:00:00Z',coverage:[{engine:'wago',status:'uncollected',reason:'No archived capture'}],lanes:[{id:'fixture-wasi',kind:'official-wasi-runner',unit:'cases',status:'failed',engine:{tag:'v1.0.0',sha256:digest('engine'),path:'/private/producer/path'},suite:{repository:'fixture/suite',revision:'a'.repeat(40)},results:[{status:'failed',outcome:'xpass'},{status:'skipped',outcome:'xfail'}],totals:{failed:1,skipped:1}},{id:'fixture-unavailable',status:'runner-error',reason:'Runner unavailable'}],padding:'source evidence '.repeat(90000)}}
test('completed conformance archive publishes through real API and existing publisher without measurements',async()=>{
 const root=await mkdtemp(join(tmpdir(),'conformance-api-'));let child,exit;
 try{
  const binary=join(root,'wasmfyi');await runCommand('go',['build','-o',binary,'./cmd/wasmfyi'],{cwd:join(site,'service'),env:{...process.env,GOMAXPROCS:'1',GOFLAGS:'-mod=readonly'}});
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const token='synthetic-token-'+'x'.repeat(32),url=`http://127.0.0.1:${port}`;child=spawn(binary,['--listen',`127.0.0.1:${port}`,'--data',join(root,'store')],{env:{...process.env,WASMFYI_ADMIN_TOKEN:token},stdio:'ignore'});exit=new Promise(r=>child.once('exit',r));
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Service exited');try{if((await fetch(url+'/api/v1/manifest')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,25))}assert(ready);
  const bytes=Buffer.from(JSON.stringify(capture())),receipt=Buffer.from(digest(bytes)+'\n'),directory=join(root,'export');await exportConformanceArchive({bytes,receipt,directory});
  let uploads=0,retried=false;const request=async(u,options)=>{if(!retried&&options.method==='PUT'){retried=true;return new Response('',{status:429,headers:{'Retry-After':'1'}})}const response=await fetch(u,options);if(options.method==='PUT'&&response.ok)uploads++;return response};
  const args={directory,url,token,request},revision=await publishConformanceExport(args);assert(retried&&uploads>0);uploads=0;assert.equal(await publishConformanceExport(args),revision);assert.equal(uploads,0);
  const json=async path=>{const response=await fetch(url+path);assert.equal(response.status,200);return response.json()};
  const page=await json('/api/v1/conformance?revision='+revision);assert.equal(page.total,2);const lane=page.items.find(row=>row.data.lane==='fixture-wasi').data;assert.equal(lane.status,'failed');assert.deepEqual(lane.totals,{failed:1,skipped:1});assert(!('path' in lane.engine));assert.equal(lane.interpretationSource,'publisher-asserted');
  const contexts=await json('/api/v1/conformance-contexts?revision='+revision+'&source='+lane.sourceId);assert.equal(contexts.total,1);assert.deepEqual(contexts.items[0].data.host,capture().host);assert.equal(contexts.items[0].data.coverageCount,1);
  const coverage=await json('/api/v1/conformance-coverage?revision='+revision+'&source='+lane.sourceId);assert.equal(coverage.total,1);assert.equal(coverage.items[0].data.status,'uncollected');assert.equal(coverage.items[0].data.reason,'No archived capture');assert(!('totals' in coverage.items[0].data));
  assert.equal((await json('/api/v1/results?revision='+revision)).total,0);
  const source=(await json('/api/v1/conformance/sources/'+lane.sourceId+'?revision='+revision)).record.data;const restored=[];for(const chunk of source.chunks){const response=await fetch(url+'/api/v1/conformance/sources/'+lane.sourceId+'/chunks?revision='+revision+'&chunk='+chunk.sha256);assert.equal(response.status,200);restored.push(Buffer.from(await response.arrayBuffer()))}assert(Buffer.concat(restored).equals(bytes));
  const isolated=join(root,'site');await mkdir(isolated);await cp(join(site,'scripts'),join(isolated,'scripts'),{recursive:true});const original=join(root,'capture');await mkdir(original);await writeFile(join(original,'report.json'),bytes);await writeFile(join(original,'sha256'),receipt);
  const publish=()=>runCommand(process.execPath,[join(isolated,'scripts/publish-conformance.mjs'),original],{cwd:isolated,env:{...process.env,WASMFYI_CONFORMANCE_API_URL:url,WASMFYI_ADMIN_TOKEN:token}});
  await publish();await publish();assert.equal((await json('/api/v1/manifest')).revision,revision);
  await assert.rejects(readFile(join(isolated,'data/conformance/index.json')),error=>error.code==='ENOENT');
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'))),object=manifest.objects[0];await writeFile(join(directory,'objects',object.sha256),'tampered');await assert.rejects(publishConformanceExport(args),/Invalid conformance publication file|Changed conformance payload/);assert.equal((await json('/api/v1/manifest')).revision,revision);
 }finally{if(child){child.kill('SIGTERM');await exit}await rm(root,{recursive:true,force:true})}
});

test('compact coverage distinguishes unrecorded, empty and explicit populations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'conformance-coverage-'));
 try{
  for(const [name,coverage,expected]of [['unrecorded',undefined,null],['empty',[],0],['recorded',[{engine:'wago',status:'uncollected',reason:'No completed capture'},{engine:'wasmtime',status:'selected'}],2]]){
   const report={...capture(),coverage,padding:undefined},bytes=Buffer.from(JSON.stringify(report)),directory=join(root,name);await exportConformanceArchive({bytes,receipt:Buffer.from(digest(bytes)+'\n'),directory});
   const manifest=JSON.parse(await readFile(join(directory,'manifest.json'))),records=[];for(const object of manifest.objects){if(object.kind==='record')records.push(JSON.parse(await readFile(join(directory,'objects',object.sha256))))}
   const context=records.find(row=>row.kind==='conformance-context');assert.equal(context.data.coverageCount,expected);assert(Buffer.byteLength(JSON.stringify(context))<10*1024);
   const rows=records.filter(row=>row.kind==='conformance-coverage');assert.equal(rows.length,expected??0);for(const row of rows){assert(['selected','uncollected'].includes(row.data.status));assert(!('totals' in row.data));assert(Buffer.byteLength(JSON.stringify(row))<10*1024)}
  }
 }finally{await rm(root,{recursive:true,force:true})}
});
