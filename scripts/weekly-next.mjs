// Queue the next shared source snapshot after this host finishes.
import assert from 'node:assert/strict';
import {readFile,writeFile,stat,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
process.env.PATH=[dirname(process.execPath),join(homedir(),'.cargo/bin'),process.env.PATH].join(':');
import {site,config,digest} from './lib/wasmbench.mjs';
import {atomicJSON,readCache} from './lib/benchmark-plan.mjs';
import {performanceCorpusIdentity} from './lib/performance-history.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {sharedWeeklySnapshot} from './lib/weekly-calendar.mjs';
const [previousArg,directoryArg]=process.argv.slice(2),previous=resolve(previousArg),directory=resolve(directoryArg);
assert((process.platform==='darwin'&&process.arch==='arm64')||(process.platform==='linux'&&process.arch==='x64'),'Weekly history requires native Apple ARM64 or Linux AMD64');
const machine=process.platform==='darwin'?'local':'hub';
const prior=await readFile(join(directory,'weekly-run.json'),'utf8').then(JSON.parse,()=>null);
if(prior && prior.pid!==process.pid && !['collected','failed','incomplete','paused'].includes(prior.status)){
 try{process.kill(prior.pid,0);throw Error('Next-week supervisor is already running');}catch(error){if(error.code!=='ESRCH')throw error;}
}
const abort=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>abort.abort());
const state={schema:1,pid:process.pid,status:'waiting-previous',started:new Date().toISOString(),engines:{}};
const save=()=>atomicJSON(join(directory,'weekly-run.json'),{...state,updated:new Date().toISOString()});
const run=(program,args,options={})=>runCommand(program,args,{cwd:site,signal:abort.signal,log:join(directory,'weekly-run.log'),onLine:line=>console.log(line),...options});
const script=(name,args,options={})=>run(process.execPath,[join(site,'scripts',name),...args],options);
await save();
try{
 while(true){
  if(abort.signal.aborted)throw Error('Interrupted');
  const current=JSON.parse(await readFile(join(previous,'weekly-run.json')));
  if(current.status==='collected')break;
  if(['failed','incomplete','paused'].includes(current.status))throw Error('Previous snapshot on this host must finish before starting the next week');
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 const settings=await config(),reuse=JSON.parse(await readFile(join(directory,'reuse.json'))),pins=JSON.parse(await readFile(join(directory,'pins.json')));
 state.machine=machine;state.calendar=sharedWeeklySnapshot(pins,JSON.parse(await readFile(join(site,'data/history-calendar.json'))));await save();
 assert.equal(reuse.context.corpusSha256,performanceCorpusIdentity((await readCache(site)).filter(w=>!w.id.startsWith('features/'))),'Queued corpus changed');
 assert.equal(reuse.context.recipeSha256,digest(JSON.stringify({harness:'9332ced5e59c0c3fd9c5aabc6ebc2ed991431eb9',collection:settings.collection,workers:'25%'})),'Queued recipe changed');
 // Preserve the completed first week before linking unchanged revisions into the next.
 await script('weekly-publish.mjs',[previous,machine]);
 state.status='building';await save();
 if(!await stat(join(directory,'frozen-harness/.git')).catch(()=>null))await run('git',['clone','--no-hardlinks',join(previous,'frozen-harness'),join(directory,'frozen-harness')]);
 if(!await stat(join(directory,'harness-pin.json')).catch(()=>null))await script('weekly-freeze.mjs',[directory,join(previous,'frozen-harness')]);
 await writeFile(join(directory,'suite.json'),JSON.stringify(await readCache(site),null,2)+'\n');
 const reused=new Set(reuse.reused.map(r=>r.engine));
 const engines=['wago','wazero','wasmtime','v8','wavm','wasmer'];
 const changed=engines.filter(e=>!reused.has(e)&&pins.pins.find(p=>p.engine===e).status==='planned');
 for(const pin of pins.pins.filter(p=>p.status==='unavailable'))state.engines[pin.engine]={status:'unavailable',reason:pin.reason};
 for(const engine of reused)state.engines[engine]={status:'reused',revision:pins.pins.find(p=>p.engine===engine).revision,from:reuse.reused.find(r=>r.engine===engine).from??previous};
 const builds=await Promise.allSettled(changed.map(async engine=>{
  const pin=pins.pins.find(p=>p.engine===engine),source=join(directory,'sources',engine);
  if(!await stat(join(source,'.git')).catch(()=>null)){
   await run('git',['clone','--depth=1','--filter=blob:none','--no-checkout','https://github.com/'+pin.repository+'.git',source]);
  }
  const head=await run('git',['rev-parse','HEAD'],{cwd:source,check:false});
  if(head.code!==0 || head.output.trim()!==pin.revision){
   await run('git',['fetch','--depth=1','origin',pin.revision],{cwd:source});
   await run('git',['checkout','--detach',pin.revision],{cwd:source});
  }
  const built=await readFile(join(directory,engine+'-build.json'),'utf8').then(JSON.parse,()=>null);
  if(built){assert.equal(built.pin.revision,pin.revision);assert.equal(built.harnessRevision,'9332ced5e59c0c3fd9c5aabc6ebc2ed991431eb9');return;}
  const env={...process.env,WEEKLY_WAGO_SOURCE:join(directory,'sources/wago'),CARGO_BUILD_JOBS:'2',RUSTUP_TOOLCHAIN:'1.98.1'};
  if(engine==='v8'){
   await run('python3',['configure','--prefix='+join(directory,'node-sdk')],{cwd:source,env,log:join(directory,'node-build.log')});
   await run('make',['-j4'],{cwd:source,env,log:join(directory,'node-build.log')});
  }
  await script('weekly-build.mjs',[directory,engine,join(directory,'frozen-harness')],{env});
 }));
 const ready=[];
 for(const [i,result] of builds.entries()){
  const engine=changed[i];
  if(result.status==='rejected'){console.error(engine+' build failed: '+result.reason.message);state.engines[engine]={status:'build-failed',reason:result.reason.message};await save();continue;}
  try{await script('weekly-collect.mjs',[directory,engine,'--qualify-only']);ready.push(engine);}
  catch(error){if(abort.signal.aborted)throw error;console.error(engine+' qualification failed: '+error.message);state.engines[engine]={status:'qualification-failed',reason:error.message};await save();}
 }
 if(abort.signal.aborted)throw Error('Interrupted');
 for(const engine of ready){
  state.status='collecting';state.engine=engine;await save();
  await script('weekly-collect.mjs',[directory,engine]);
  const completed=JSON.parse(await readFile(join(directory,'sessions',engine,'state.json')));
  assert(['completed','completed-with-failures'].includes(completed.status),'Incomplete '+engine);
  state.engines[engine]={status:completed.status,finished:new Date().toISOString()};await save();
 }
 state.status='publishing';delete state.engine;await save();
 await script('weekly-publish.mjs',[directory,machine]);
 state.status='collected';await save();
 console.log('Next historical week collected; unchanged source hashes reused without duplicate evidence.');
}catch(error){state.status=abort.signal.aborted?'paused':'failed';state.reason=error.message;await save();throw error;}
