import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const coordinator=new URL('./benchmark-history-coordinator.mjs',import.meta.url).pathname;
async function fixture(failure,workloadErrors=[]){
 const root=await mkdtemp(join(tmpdir(),'weekly-coordinator-')),site=join(root,'site');
 const newest='2026-10-09T08:07:55.636Z',previous='2026-10-04T10:00:00.000Z';
 await mkdir(join(site,'scripts'),{recursive:true});await mkdir(join(root,'frozen-harness'));
 await writeFile(join(root,'controller'),'existing controller');
 await writeFile(join(root,'collection-template.json'),JSON.stringify({controller:join(root,'controller'),collection:{samples:5},historyNotBefore:'2026-06-28'}));
 await writeFile(join(root,'source-plan.json'),JSON.stringify({pins:[newest,previous].flatMap(targetWeek=>['wago','wasmtime','wazero'].map(engine=>({engine,targetWeek,status:'planned'})))}));
 const runner=`import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';
 const [root,base,engine]=process.argv.slice(2),week=process.env.WASMFYI_HISTORY_WEEK;
 const path=join(root,'calls.json');const calls=JSON.parse(await readFile(path).catch(()=> '[]'));calls.push({engine,week});await writeFile(path,JSON.stringify(calls));
 const statusFile=join(root,['wago','wazero'].includes(engine)?'build-status.json':engine+'-history-status.json');
 await writeFile(statusFile,JSON.stringify({completed:engine==='wasmtime'&&${JSON.stringify(workloadErrors.length>0)}?[{engine,configuration:'wasmtime',pinKey:engine+'|main|hash|'+week,asOf:week,workloadErrors:week===${JSON.stringify(newest)}?${JSON.stringify(workloadErrors)}:[]}]:[],errors:${JSON.stringify(failure)}===engine&&week===${JSON.stringify(newest)}?[{engine,pinKey:engine+'|main|hash|'+week,error:'SDK build failed'}]:[]}));`;
 for(const name of ['benchmark-go-history.mjs','benchmark-engine-history.mjs'])await writeFile(join(site,'scripts',name),runner);
 await writeFile(join(site,'scripts/link-history-aliases.mjs'),'process.exit(0);');
 return {root,site,newest,previous};
}
test('real coordinator launches every newest engine before any older week',async()=>{
 const f=await fixture(null);try{
  await execute(process.execPath,[coordinator,f.root,join(f.root,'frozen-harness')],{cwd:f.site});
  assert.deepEqual(JSON.parse(await readFile(join(f.root,'calls.json'))),[f.newest,f.previous].flatMap(week=>['wago','wasmtime','wazero'].map(engine=>({engine,week}))));
  const status=JSON.parse(await readFile(join(f.root,'coordinator-status.json')));assert.deepEqual(status.finishedWeeks,[f.newest,f.previous]);assert.equal(status.schedule,'week-by-week');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('completed source with protocol-failed trials holds history without losing successful coverage',async()=>{
 const f=await fixture(null,[{kind:'failed-trials',workload:'applications/columnar-query',error:'sacrificial check: protocol version or request identity mismatch'}]);
 try{
  await execute(process.execPath,[coordinator,f.root,join(f.root,'frozen-harness')],{cwd:f.site});
  assert.deepEqual(JSON.parse(await readFile(join(f.root,'calls.json'))),['wago','wasmtime','wazero'].map(engine=>({engine,week:f.newest})));
  const s=JSON.parse(await readFile(join(f.root,'coordinator-status.json')));
  assert.equal(s.stage,'latest-week-needs-repair');assert.equal(s.errors[0].workloadErrors[0].workload,'applications/columnar-query');
  assert.deepEqual(s.finishedEngines,['wago','wazero']);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('completed source with genuine unsupported cases or bounded timeouts proceeds to older weeks',async()=>{
 const f=await fixture(null,[{kind:'timeout',error:'The operation was aborted due to timeout',budgetMs:300000},{kind:'failed-trials',error:'unsupported: SIMD is not implemented'}]);
 try{
  await execute(process.execPath,[coordinator,f.root,join(f.root,'frozen-harness')],{cwd:f.site});
  const s=JSON.parse(await readFile(join(f.root,'coordinator-status.json')));
  assert.deepEqual(s.finishedWeeks,[f.newest,f.previous]);assert.deepEqual(s.errors,[]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('completed source with invalid sample capture holds older history',async()=>{
 const f=await fixture(null,[{kind:'capture-error',workload:'wago/tiny/add',error:'Error: Invalid ordered latency samples'}]);
 try{
  await execute(process.execPath,[coordinator,f.root,join(f.root,'frozen-harness')],{cwd:f.site});
  const s=JSON.parse(await readFile(join(f.root,'coordinator-status.json')));
  assert.equal(s.stage,'latest-week-needs-repair');
  assert.deepEqual(s.finishedWeeks,[]);
  assert.equal(s.errors[0].workloadErrors[0].workload,'wago/tiny/add');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('missing Node adapter dependencies hold older history instead of becoming workload outcomes',async()=>{
 for(const error of ["Error: Cannot find module '/site/scripts/lib/shared-device-slice.mjs'", "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'adapter-helper' imported from worker.mjs"]){
  const f=await fixture(null,[{kind:'capture-error',workload:'wago/tiny/add',error}]);
  try{
   await execute(process.execPath,[coordinator,f.root,join(f.root,'frozen-harness')],{cwd:f.site});
   const s=JSON.parse(await readFile(join(f.root,'coordinator-status.json')));
   assert.equal(s.stage,'latest-week-needs-repair');
   assert.deepEqual(s.finishedWeeks,[]);
   assert.equal(s.errors[0].workloadErrors[0].error,error);
  }finally{await rm(f.root,{recursive:true,force:true});}
 }
});
test('newest coverage attempts every engine then holds older weeks for a real build gap',async()=>{
 const f=await fixture('wasmtime');try{
  await execute(process.execPath,[coordinator,f.root,join(f.root,'frozen-harness')],{cwd:f.site});
  assert.deepEqual(JSON.parse(await readFile(join(f.root,'calls.json'))),['wago','wasmtime','wazero'].map(engine=>({engine,week:f.newest})));
  const status=JSON.parse(await readFile(join(f.root,'coordinator-status.json')));assert.equal(status.stage,'latest-week-needs-repair');assert.equal(status.errors.length,1);assert.deepEqual(status.finishedWeeks,[]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('coordinator publishes actual live child PID and clears it after completion',async()=>{
 const f=await fixture(null);let child;
 try {
  const runner=join(f.site,'scripts/benchmark-go-history.mjs');
  const original=await readFile(runner,'utf8');
  await writeFile(runner,original+`\nif(engine==='wago'&&week===${JSON.stringify(f.newest)}){await writeFile(join(root,'worker-pid'),String(process.pid));while(!await readFile(join(root,'release')).catch(()=>null))await new Promise(r=>setTimeout(r,10));}`);
  child=spawn(process.execPath,[coordinator,f.root,join(f.root,'frozen-harness')],{cwd:f.site,stdio:'ignore'});
  const finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('coordinator exited '+code)));});
  let observed;
  for(let i=0;i<200;i++){
   const pid=Number(await readFile(join(f.root,'worker-pid')).catch(()=>0));
   const status=JSON.parse(await readFile(join(f.root,'coordinator-status.json')).catch(()=> '{}'));
   if(pid&&status.childPid===pid){observed=pid;break;}
   await new Promise(r=>setTimeout(r,10));
  }
  assert.ok(observed,'running child PID must be atomically published');
  process.kill(observed,0);
  await writeFile(join(f.root,'release'),'ready');await finished;
  assert.equal(JSON.parse(await readFile(join(f.root,'coordinator-status.json'))).childPid,null);
 }finally{
  if(child&&child.exitCode===null){await writeFile(join(f.root,'release'),'cleanup');child.kill();}
  await rm(f.root,{recursive:true,force:true});
 }
});
test('source integration gaps are visible while remaining engines are still running',async()=>{
 const f=await fixture('wasmtime');let child;
 try{
  const path=join(f.site,'scripts/benchmark-go-history.mjs');
  await writeFile(path,(await readFile(path,'utf8'))+`\nif(engine==='wazero'){while(!await readFile(join(root,'release')).catch(()=>null))await new Promise(r=>setTimeout(r,10));}`);
  child=spawn(process.execPath,[coordinator,f.root,join(f.root,'frozen-harness')],{cwd:f.site,stdio:'ignore'});
  const finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('coordinator '+code)));});
  let observed;
  for(let i=0;i<200;i++){const status=JSON.parse(await readFile(join(f.root,'coordinator-status.json')).catch(()=> '{}'));if(status.current==='wazero'&&status.pendingWeekErrors?.length){observed=status;break;}await new Promise(r=>setTimeout(r,10));}
  assert.ok(observed,'completed source gap must be visible before the whole week ends');
  assert.equal(observed.pendingWeekErrors[0].engine,'wasmtime');assert.deepEqual(observed.finishedWeeks,[]);
  await writeFile(join(f.root,'release'),'ready');await finished;
  const final=JSON.parse(await readFile(join(f.root,'coordinator-status.json')));assert.equal(final.stage,'latest-week-needs-repair');assert.equal(final.errors.length,1);
 }finally{if(child&&child.exitCode===null){await writeFile(join(f.root,'release'),'cleanup');child.kill();}await rm(f.root,{recursive:true,force:true});}
});
test('week-end alias capture scan waits for the same host exclusion lease as measurements',async()=>{
 const f=await fixture(null);let child;
 try{
  const lease=join(f.root,'measurement-lock');await mkdir(lease);await writeFile(join(lease,'owner'),String(process.pid));
  await writeFile(join(f.site,'scripts/link-history-aliases.mjs'),`import {writeFile} from 'node:fs/promises';await writeFile(${JSON.stringify(join(f.root,'alias-started'))},'started');`);
  child=spawn(process.execPath,[coordinator,f.root,join(f.root,'frozen-harness')],{cwd:f.site,stdio:'ignore'});
  const finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('coordinator '+code)));});
  let ready=false;for(let i=0;i<200;i++){const status=JSON.parse(await readFile(join(f.root,'coordinator-status.json')).catch(()=> '{}'));if(status.finishedEngines?.length===3&&!status.childPid){ready=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.ok(ready,'engine coverage should finish while aliases wait for the live reservation');
  await new Promise(r=>setTimeout(r,300));assert.equal(await readFile(join(f.root,'alias-started')).catch(()=>null),null);
  await rm(lease,{recursive:true});await finished;assert.equal(await readFile(join(f.root,'alias-started'),'utf8'),'started');
 }finally{if(child&&child.exitCode===null){await rm(join(f.root,'measurement-lock'),{recursive:true,force:true});child.kill();}await rm(f.root,{recursive:true,force:true});}
});
