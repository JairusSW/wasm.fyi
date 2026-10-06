import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {digest} from './lib/wasmbench.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {publishHistoryCoverage} from './lib/performance-history-coverage-api.mjs';
const site=fileURLToPath(new URL('..',import.meta.url)),hash=value=>digest(Buffer.from(value));
test('history coverage publishes bounded metadata batches through the real API without results',async()=>{
 const root=await mkdtemp(join(tmpdir(),'history-coverage-api-'));let child,exit;
 try{
  const binary=join(root,'wasmfyi');await runCommand('go',['build','-o',binary,'./cmd/wasmfyi'],{cwd:join(site,'service'),env:{...process.env,GOMAXPROCS:'1',GOFLAGS:'-mod=readonly'}});
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const token='coverage-fixture-'+'x'.repeat(32),url=`http://127.0.0.1:${port}`;child=spawn(binary,['--listen',`127.0.0.1:${port}`,'--data',join(root,'store')],{env:{...process.env,WASMFYI_ADMIN_TOKEN:token},stdio:'ignore'});exit=new Promise(r=>child.once('exit',r));
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Service exited');try{if((await fetch(url+'/api/v1/manifest')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,25))}assert(ready);
  const configurations=Array.from({length:105},(_,i)=>'wasmtime-'+i),jobId=hash('job');
  const queue={host:'darwin/arm64',corpusSha256:hash('contracts'),recipeSha256:hash('recipe'),jobs:[{id:jobId,release:{engine:'wasmtime',targetType:'weekly',tag:'v40.0.0',publishedAt:'2026-10-01T12:00:00Z',datePrecision:'second',url:'https://example.test/release?a=1&b=2'},identity:{configurations},targetWeeks:['2026-10-03']}],snapshots:[{engine:'wago',status:'unavailable',targetType:'release',targetRelease:'v999.0.0',reason:'Missing <receipt> & no source \u2028 captured'}]};
  const ledger={jobs:[]},input={queue,ledger,configured:configurations,url,token};let uploads=0,retry=false;input.request=async(u,options)=>{if(options.method==='PUT')uploads++;if(!retry&&u.endsWith('/imports')){retry=true;return new Response('',{status:429,headers:{'Retry-After':'1'}})}return fetch(u,options)};
  const first=await publishHistoryCoverage(input);assert.equal(first.imports,2);assert(retry);assert.equal(uploads,0);assert.deepEqual(await publishHistoryCoverage(input),first);
  const get=async path=>{const response=await fetch(url+path);assert.equal(response.status,200);return response.json()};
  const initial=await get('/api/v1/history/coverage?revision='+first.revision+'&limit=1000');assert.equal(initial.total,106);assert(initial.items.every(row=>row.data.sourceReportSha256===null));const gap=initial.items.find(row=>row.data.configuration===null);assert.equal(gap.data.reason,queue.snapshots[0].reason);assert.deepEqual(gap.data.targetDates,[]);
  for(const route of ['results','history'])assert.equal((await get('/api/v1/'+route+'?revision='+first.revision)).total,0);
  ledger.jobs=[{id:jobId,configurations:[{id:configurations[0],status:'runner-error',reason:'Recorded runner error'}]}];
  const second=await publishHistoryCoverage(input);assert.notEqual(second.revision,first.revision);assert.equal((await get('/api/v1/manifest')).revision,second.revision,'unchanged final batch returned an obsolete revision');
  const updated=await get('/api/v1/history/coverage?revision='+second.revision+'&limit=1000');assert.equal(updated.total,106);assert.equal(updated.items.find(row=>row.data.configuration===configurations[0]).data.status,'runner-error');assert.equal((await get('/api/v1/history/coverage?revision='+first.revision+'&limit=1000')).items.find(row=>row.data.configuration===configurations[0]).data.status,'uncollected');
  const isolated=join(root,'site'),historyRoot=join(isolated,'.wasmbench/performance-history'),unavailableHarness=join(root,'no-controller');await mkdir(historyRoot,{recursive:true});await mkdir(unavailableHarness);await cp(join(site,'scripts'),join(isolated,'scripts'),{recursive:true});
  const suite=join(historyRoot,'suite.json');await writeFile(suite,'[]');
  const emptyQueue={...queue,corpusSha256:hash('[]'),jobs:[{...queue.jobs[0],identity:{configurations:[configurations[0]]}}],snapshots:[]};
  await writeFile(join(historyRoot,'queue.json'),JSON.stringify({...emptyQueue,suite}));await writeFile(join(historyRoot,'results.json'),JSON.stringify({jobs:[]}));await writeFile(join(isolated,'wasmbench.config.json'),JSON.stringify({root:unavailableHarness,collection:{runtimes:[configurations[0]]},harnessSource:{revision:'0509a0a323f41c58a2f2db15a372fb2e63c692bf'}}));
  await assert.rejects(runCommand(process.execPath,[join(isolated,'scripts/performance-history-collect.mjs')],{cwd:isolated,env:{...process.env,WASMFYI_HISTORY_API_URL:url,WASMFYI_HISTORY_PUBLISH_ONLY:'1',WASMFYI_ADMIN_TOKEN:token,WASMBENCH_ROOT:unavailableHarness}}));
  const retained=JSON.parse(await readFile(join(historyRoot,'results.json')));assert.equal(retained.phase,'incomplete');assert.equal(retained.apiCoverage.status,'published');assert.equal(retained.jobs[0].configurations[0].status,'not-collected');assert.equal((await get('/api/v1/history/coverage?revision='+retained.apiCoverage.revision)).total,107);

 }finally{if(child){child.kill('SIGTERM');await exit}await rm(root,{recursive:true,force:true})}
});
