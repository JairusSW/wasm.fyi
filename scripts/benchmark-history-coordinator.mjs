import {readFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {copyHistoricalHarness} from './lib/historical-binding.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {historyEngineOrder} from './lib/history-scope.mjs';
const [rootArg,baseArg]=process.argv.slice(2),root=resolve(rootArg),base=resolve(baseArg);
const template=JSON.parse(await readFile(join(root,'collection-template.json')));
if(template.collection.samples<1)throw Error('A positive sample count is required');
const env={...process.env,...template.env,GOMAXPROCS:'1',CARGO_BUILD_JOBS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1'};
const state={status:'running',stage:'corpus-history',started:new Date().toISOString(),current:null,finishedEngines:[],errors:[]};
async function run(binary,args,options={}) {
 return new Promise((yes,no)=>{const fd=openSync(join(root,'coordinator.log'),'a');const child=spawn(binary,args,{cwd:process.cwd(),env,stdio:['ignore',fd,fd],...options});closeSync(fd);state.childPid=child.pid;child.on('error',no);child.on('exit',code=>code===0?yes():no(Error(binary+' exited '+code)));});
}
const frozen=join(root,'frozen-harness');
if(!await stat(frozen).catch(()=>null)) {
 await copyHistoricalHarness(base,frozen);
 await run('git',['init',frozen]);await run('git',['-C',frozen,'add','.']);
 await run('git',['-C',frozen,'-c','user.name=Benchmark collector','-c','user.email=collector@localhost','commit','-m','Frozen twelve-sample benchmark harness']);
}
if(!await stat(template.controller).catch(()=>null))await run('go',['build','-o',template.controller,'./cmd/wasmbench'],{cwd:frozen});
for(const engine of historyEngineOrder) {
 state.current=engine;await atomicJSON(join(root,'coordinator-status.json'),state);
 try {
  const script=['wago','wazero','wasm2go'].includes(engine)?'benchmark-go-history.mjs':engine==='libwasm'?'benchmark-libwasm-history.mjs':'benchmark-engine-history.mjs';
  const args=engine==='libwasm'?[root,template.toolRoot||join(resolve(process.cwd()),'.wasmfyi/local')]:[root,frozen,engine];
  await run(process.execPath,[join(process.cwd(),'scripts',script),...args]);
  const status=JSON.parse(await readFile(join(root,['wago','wazero','wasm2go'].includes(engine)?'build-status.json':engine==='libwasm'?'libwasm-status.json':engine+'-history-status.json')));
  const unresolved=status.errors.filter(error=>error.engine===engine||engine==='libwasm'||!error.engine).filter(error=>!status.completed.some(done=>done.pinKey&&done.pinKey===error.pinKey));
  if(unresolved.length)state.errors.push({engine,count:unresolved.length,reason:'Source build or capture jobs require repair'});
  else state.finishedEngines.push(engine);
 } catch(error){state.errors.push({engine,error:String(error)});}
 state.updated=new Date().toISOString();await atomicJSON(join(root,'coordinator-status.json'),state);
}
// Features wait for a complete corpus-history audit; a finished subprocess alone
// does not prove that every source/configuration/workload has been measured.
state.current=null;state.status='awaiting-completion-audit';await atomicJSON(join(root,'coordinator-status.json'),state);
