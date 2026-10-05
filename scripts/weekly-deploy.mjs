// Publish owned historical data from an isolated main-based checkout.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {site,exists} from './lib/wasmbench.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {validateData} from './lib/validate-data.mjs';
import {writeIndex,appendReports,datasetFiles} from './lib/snapshot-index.mjs';
import {assertWeeklyParity} from './lib/weekly-parity.mjs';
import {weeklyPinIdentity} from './lib/weekly-calendar.mjs';
const folder=join(site,'.wasmbench/history-background/publication');
const run=(p,args,options={})=>runCommand(p,args,{cwd:folder,onLine:line=>console.log(line),...options});
await runCommand('git',['fetch','origin','main'],{cwd:site});
if(!await exists(join(folder,'.git')))await runCommand('git',['worktree','add','--detach',folder,'origin/main'],{cwd:site});
// This checkout is owned by this publisher. Its generated static index is rebuilt
// by CI; restore only that generated path before checking for unexpected edits.
await run('git',['restore','--','static/wasmbench/index.json']);
const dirty=(await run('git',['status','--porcelain','--untracked-files=no'])).output.trim();
if(dirty){
 assert(dirty.split('\n').every(line=>/^.{2} data\/(?:history(?:-hub)?\/|history-calendar\.json|benchmark-runs\/)/.test(line)),'Publication checkout has unexpected edits');
 await run('git',['restore','--staged','--worktree','--','data/history','data/history-hub','data/history-calendar.json','data/benchmark-runs']);
}
const previous=(await run('git',['rev-parse','HEAD'])).output.trim();
await run('git',['update-ref','refs/wasm-fyi-history-publication/previous',previous]);
await run('git',['switch','--detach','origin/main']);
const calendar=JSON.parse(await readFile(join(site,'data/history-calendar.json')));
const existing=JSON.parse(await readFile(join(folder,'data/history-calendar.json')));
for(const old of existing.weeks){const next=calendar.weeks.find(w=>w.date===old.date);if(next)assert.equal(weeklyPinIdentity(next).identity,weeklyPinIdentity(old).identity,'Concurrent calendar source pins differ');else calendar.weeks.push(old);}
calendar.weeks.sort((a,b)=>a.date.localeCompare(b.date));
for(const name of ['history','history-hub']){
 const source=join(site,'data',name),target=join(folder,'data',name),incoming=await validateData(source),current=await validateData(target);
 for(const file of datasetFiles(incoming))if(file!=='index.json')await cp(join(source,file),join(target,file));
 await writeIndex(target,appendReports(current.reports,incoming.reports));
 const ours=JSON.parse(await readFile(join(source,'weekly.json'))),theirs=JSON.parse(await readFile(join(target,'weekly.json')));
 for(const point of theirs.results){
  const next=ours.results.find(p=>new Date(p.targetWeek).toISOString()===new Date(point.targetWeek).toISOString());
  if(!next){ours.results.push(point);continue;}
  for(const [id,value] of Object.entries(point.engines??{})){
   if(next.engines?.[id])assert.equal(next.engines[id].revision,value.revision,'Concurrent historical source pin differs');
   else{next.engines??={};next.engines[id]=value;}
  }
 }
 ours.results.sort((a,b)=>+new Date(a.targetWeek)-+new Date(b.targetWeek));ours.weeks=ours.results.map(p=>p.targetWeek);
 await writeFile(join(target,'weekly.json'),JSON.stringify(ours,null,2)+'\n');await validateData(target);
}
await writeFile(join(folder,'data/history-calendar.json'),JSON.stringify(calendar,null,2)+'\n');
const bundleSource=join(site,'data/benchmark-runs');
for(const name of await readdir(bundleSource))if(name.startsWith('weekly-'))await cp(join(bundleSource,name),join(folder,'data/benchmark-runs',name),{recursive:true});
const arm=JSON.parse(await readFile(join(folder,'data/history/weekly.json'))),amd=JSON.parse(await readFile(join(folder,'data/history-hub/weekly.json')));
assertWeeklyParity(arm,amd,calendar);
await run('git',['add','data/history','data/history-hub','data/history-calendar.json',... (await readdir(join(folder,'data/benchmark-runs'))).filter(n=>n.startsWith('weekly-')).map(n=>'data/benchmark-runs/'+n)]);
if(!(await run('git',['diff','--cached','--name-only'])).output.trim()){console.log('Historical website already matches the checkpoint.');process.exit(0);}
await run('git',['commit','-m','Publish shared-calendar historical benchmark checkpoint']);
const revision=(await run('git',['rev-parse','HEAD'])).output.trim();
await run('git',['update-ref','refs/wasm-fyi-history-publication/checkpoint',revision]);
await run('git',['push','origin','HEAD:main']);
// Report deployment completion separately from a successful push.
for(let attempt=0;attempt<120;attempt++){
 const output=await run('gh',['run','list','--workflow','deploy-pages.yml','--commit',revision,'--limit','1','--json','databaseId,status,conclusion']);
 const [workflow]=JSON.parse(output.output);
 if(workflow?.status==='completed'){
  assert.equal(workflow.conclusion,'success','Pages deployment failed: '+workflow.databaseId);
  console.log(`Historical checkpoint deployed: ${revision} (Pages ${workflow.databaseId})`);process.exit(0);
 }
 await new Promise(r=>setTimeout(r,30000));
}
throw Error('Historical checkpoint pushed; Pages has not completed within one hour');
