import {readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {copyHistoricalHarness} from './lib/historical-binding.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {historyEngineOrder} from './lib/history-scope.mjs';
import {historySchedule} from './lib/history-schedule.mjs';
import {completedHistoryIntegrationFailures} from './lib/history-completion-audit.mjs';
import {withBuildLock} from './lib/measurement-lock.mjs';
const [rootArg,baseArg]=process.argv.slice(2),root=resolve(rootArg),base=resolve(baseArg);
const template=JSON.parse(await readFile(join(root,'collection-template.json')));
const plan=JSON.parse(await readFile(join(root,'source-plan.json')));
if(template.collection.samples<1)throw Error('A positive sample count is required');
const env={...process.env,...template.env,WASMFYI_HISTORY_FAST:'1'};
const state={status:'running',stage:'latest-week',schedule:'engine-grouped',started:new Date().toISOString(),current:null,currentWeek:null,finishedEngines:[],finishedWeeks:[],errors:[]};
const save=async()=>{state.updated=new Date().toISOString();await atomicJSON(join(root,'coordinator-status.json'),state)};
async function run(binary,args,options={}) {
 const fd=openSync(join(root,'coordinator.log'),'a');
 let child;
 try {child=spawn(binary,args,{cwd:process.cwd(),env,stdio:['ignore',fd,fd],...options});}
 finally {closeSync(fd);}
 state.childPid=child.pid??null;
 const completion=new Promise((yes,no)=>{
  child.on('error',no);
  child.on('exit',code=>code===0?yes():no(Error(binary+' exited '+code)));
 });
 try {await Promise.all([save(),completion]);}
 finally {state.childPid=null;await save();}
}
const frozen=join(root,'frozen-harness');
if(!await stat(frozen).catch(()=>null)) {
 await copyHistoricalHarness(base,frozen);
 await run('git',['init',frozen]);await run('git',['-C',frozen,'add','.']);
 await run('git',['-C',frozen,'-c','user.name=Benchmark collector','-c','user.email=collector@localhost','commit','-m','Frozen grouped-sample benchmark harness']);
}
if(!await stat(template.controller).catch(()=>null))await run('go',['build','-o',template.controller,'./cmd/wasmbench'],{cwd:frozen});
const weeklySchedule=historySchedule(plan,template,historyEngineOrder);
// Cover latest gaps first, then keep each engine's cached source/SDK locality.
const scheduled=[...weeklySchedule.filter(row=>row.latest),...historyEngineOrder.flatMap(engine=>weeklySchedule.filter(row=>!row.latest&&row.engines.includes(engine)).map(row=>({...row,engines:[engine]})))];
for(const [scheduleIndex,{week,latest,engines}] of scheduled.entries()) {
 state.currentWeek=week;state.stage=latest?'latest-week':'corpus-history';state.finishedEngines=[];
 const weekErrors=[];state.pendingWeekErrors=weekErrors;
 for(const engine of engines) {
  state.current=engine;await save();
  try {
   const go=['wago','wazero','wasm2go'].includes(engine);
   const script=go?'benchmark-go-history.mjs':engine==='libwasm'?'benchmark-libwasm-history.mjs':'benchmark-engine-history.mjs';
   const args=engine==='libwasm'?[root,template.toolRoot||join(resolve(process.cwd()),'.wasmfyi/local')]:[root,frozen,engine];
   await run(process.execPath,[join(process.cwd(),'scripts',script),...args],{env:{...env,WASMFYI_HISTORY_WEEK:week}});
   const status=JSON.parse(await readFile(join(root,go?'build-status.json':engine==='libwasm'?'libwasm-status.json':engine+'-history-status.json')));
   const unresolved=status.errors.filter(error=>error.engine===engine||engine==='libwasm'||!error.engine).filter(error=>{
    const targetWeek=error.asOf||error.pinKey?.split('|').at(-1);
    return !targetWeek||new Date(targetWeek).toISOString()===week;
   }).filter(error=>!status.completed.some(done=>done.pinKey&&done.pinKey===error.pinKey));
   const integrationFailures=completedHistoryIntegrationFailures(status,engine,week,root);
   if(unresolved.length||integrationFailures.length)weekErrors.push({engine,week,count:unresolved.length+integrationFailures.length,reason:'Source build or capture integration requires repair',...(integrationFailures.length?{workloadErrors:integrationFailures}:{})});
   else state.finishedEngines.push(engine);
  } catch(error){weekErrors.push({engine,week,error:String(error)});}
  await save();
 }
 // Aliases reuse measurements for identical source hashes and never run guests.
 try {if(latest||engines[0]!==scheduled[scheduleIndex+1]?.engines[0])await withBuildLock(root,()=>run(process.execPath,[join(process.cwd(),'scripts/link-history-aliases.mjs'),root]));}
 catch(error){weekErrors.push({week,error:String(error),reason:'Source aliases require repair'});}
 state.errors.push(...weekErrors);
 if(weekErrors.length){
  // Finish this week's engine coverage attempt, then repair gaps before older
  // history. Existing successful captures are reused on every safe restart.
  state.current=null;state.stage=latest?'latest-week-needs-repair':'week-needs-repair';
  state.status='awaiting-completion-audit';await save();process.exit(0);
 }
 if(!state.finishedWeeks.includes(week))state.finishedWeeks.push(week);await save();
}
state.current=null;state.currentWeek=null;state.status='awaiting-completion-audit';await save();
