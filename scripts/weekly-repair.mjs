// Run at a native weekly boundary, while the host measurement lease is held.
// Repair one existing build gap without replacing any sealed measurements.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {site} from './lib/wasmbench.mjs';
const [previousArg]=process.argv.slice(2),previous=resolve(previousArg),parent=dirname(previous);
const machine=process.platform==='darwin'?'local':'hub';
const run=(script,args)=>runCommand(process.execPath,[join(site,'scripts',script),...args],{cwd:site,onLine:console.log});
// July 18 is the first requested recovery; remaining existing gaps follow newest first.
const weeks=(await readdir(parent)).filter(w=>/^weekly-\d{8}$/.test(w)).sort().reverse();
weeks.sort((a,b)=>Number(b==='weekly-20260718')-Number(a==='weekly-20260718'));
for(const week of weeks){
 const directory=join(parent,week),path=join(directory,'weekly-run.json');
 const state=await readFile(path,'utf8').then(JSON.parse,()=>null);
 if(state?.status!=='collected'||(!state.engines?.wago?.repairPending && !['build-failed','qualification-failed'].includes(state.engines?.wago?.status)))continue;
 const session=await readFile(join(directory,'sessions/wago/state.json'),'utf8').then(JSON.parse,()=>null);
 // Resume the existing identity if a corpus capture was interrupted.
 const pin=JSON.parse(await readFile(join(directory,'pins.json'))).pins.find(p=>p.engine==='wago');
 if(pin?.status!=='planned')continue;
 console.log(`Repairing ${machine} ${week} Wago ${pin.revision}`);
 try{
  if(!session)await run('weekly-build.mjs',[directory,'wago',join(directory,'frozen-harness')]);
  await run('weekly-collect.mjs',[directory,'wago','--qualify-only']);
  await run('weekly-collect.mjs',[directory,'wago']);
  const completed=JSON.parse(await readFile(join(directory,'sessions/wago/state.json')));
  assert(['completed','completed-with-failures'].includes(completed.status),'Repair is incomplete');
  state.engines.wago={status:completed.status,finished:new Date().toISOString(),repaired:true,repairPending:true};
  await atomicJSON(path,state);
  await run('weekly-publish.mjs',[directory,machine,'wago']);
  delete state.engines.wago.repairPending;await atomicJSON(path,state);
  const journalPath=join(parent,'history-repairs.json');
  const journal=await readFile(journalPath,'utf8').then(JSON.parse,()=>({schema:1,weeks:[]}));
  if(!journal.weeks.includes(week))journal.weeks.push(week);await atomicJSON(journalPath,journal);
 }catch(error){console.error('Wago repair retained for resume: '+error.message);}
 break;
}
