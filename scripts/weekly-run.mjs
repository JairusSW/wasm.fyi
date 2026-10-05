// Collect the pinned host snapshots serially after their builds finish.
import {readFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {site} from './lib/wasmbench.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
const [directoryArg,nodeMakePid]=process.argv.slice(2),directory=resolve(directoryArg),engines=['wago','wazero','wasmtime','v8','wavm','wasmer'];
const abort=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>abort.abort());
const state={schema:1,pid:process.pid,status:'waiting-builds',started:new Date().toISOString(),engines:{}};
const save=()=>atomicJSON(join(directory,'weekly-run.json'),{...state,updated:new Date().toISOString()});
const run=(script,args)=>runCommand(process.execPath,[join(site,'scripts',script),...args],{cwd:site,signal:abort.signal,check:false,log:join(directory,'weekly-run.log'),onLine:line=>console.log(line)});
await save();
try {
 while(true) {
  if(abort.signal.aborted)throw Error('Interrupted');
  let building=false;
  if(nodeMakePid){try{const p=execFileSync('ps',['-p',nodeMakePid,'-o','comm=']).toString();building=/make/.test(p);}catch{}}
  const ready=await Promise.all(engines.filter(e=>e!=='v8').map(e=>readFile(join(directory,e+'-build.json'),'utf8').then(JSON.parse,()=>null)));
  if(!building && ready.every(r=>r?.harnessRevision==='9332ced5e59c0c3fd9c5aabc6ebc2ed991431eb9'))break;
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 const existingV8=await readFile(join(directory,'v8-build.json'),'utf8').then(JSON.parse,()=>null);
 if(!existingV8) {
  state.status='qualifying-v8';await save();
  if((await run('weekly-build.mjs',[directory,'v8',join(directory,'frozen-harness')])).code!==0)throw Error('V8 source build qualification failed');
 }
 for(const engine of engines)if((await run('weekly-collect.mjs',[directory,engine,'--qualify-only'])).code!==0)throw Error('Runtime qualification failed: '+engine);
 for(const engine of engines) {
  state.status='collecting';state.engine=engine;await save();
  const result=await run('weekly-collect.mjs',[directory,engine]);
  const completed=await readFile(join(directory,'sessions',engine,'state.json'),'utf8').then(JSON.parse,()=>null);
  state.engines[engine]={exitCode:result.code,status:completed?.status || 'failed',finished:new Date().toISOString()};await save();
  if(abort.signal.aborted)throw Error('Interrupted');
 }
 state.status=Object.values(state.engines).every(r=>['completed','completed-with-failures'].includes(r.status))?'collected':'incomplete';delete state.engine;await save();
 if(state.status!=='collected')process.exitCode=1;
} catch(error) {state.status=abort.signal.aborted?'paused':'failed';state.reason=error.message;await save();throw error;}
