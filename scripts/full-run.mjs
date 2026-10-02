import{mkdir,readFile,writeFile,rename}from'node:fs/promises';
import{join,resolve}from'node:path';
import{spawn}from'node:child_process';
import{openSync,closeSync}from'node:fs';
import{config,site}from'./lib/wasmbench.mjs';
import{featureConfigurations}from'./lib/feature-configurations.mjs';
const directory=resolve(process.argv[2] || join(site,'.wasmbench/full-run'));
await mkdir(directory,{recursive:true});
const settings=await config(),runtimes=featureConfigurations(settings);
const state={schema:1,pid:process.pid,startedAt:new Date().toISOString(),host:process.platform+'/'+process.arch,phase:'starting',runtimes,suite:'all',historyWeeks:53,steps:[]};
async function save(){const path=join(directory,'status.json');await writeFile(path+'.tmp',JSON.stringify(state,null,2)+'\n');await rename(path+'.tmp',path);}
async function step(name,args,extra={}){
 state.phase=name;const entry={name,startedAt:new Date().toISOString(),status:'running',log:join(directory,name+'.log')};state.steps.push(entry);await save();
 const fd=openSync(entry.log,'a');const child=spawn(process.execPath,args,{cwd:site,stdio:['ignore',fd,fd],env:{...process.env,...extra}});entry.pid=child.pid;await save();
 const code=await new Promise((yes,no)=>{child.on('error',no);child.on('close',yes)});closeSync(fd);entry.status=code===0?'passed':'failed';entry.exitCode=code;entry.completedAt=new Date().toISOString();await save();if(code!==0)throw Error(name+' failed; inspect '+entry.log);
}
await save();
try{
 const env={WASMBENCH_SUITE:'all',WASMBENCH_RUNTIMES:runtimes.join(','),WASMBENCH_VALIDATION_PROFILE:'all',WASMBENCH_RECORD_FAILURES:'1',WASMBENCH_TIMEOUT:'300s'};
 await step('build',['scripts/bench.mjs','build'],env);
 await step('compile-audit',['scripts/compile-latency-audit.mjs',join(directory,'compile-audit')]);
 await step('collect',['scripts/bench.mjs','collect'],env);
 const report=(await readFile(join(site,'.wasmbench/latest-report.txt'),'utf8')).trim();state.report=report;await save();
 await step('history-plan',['scripts/history.mjs','plan'],{WASMBENCH_HISTORY_WEEKS:'53'});
 await step('history-conformance',['scripts/history.mjs','collect'],{WASMBENCH_HISTORY_WEEKS:'53'});
 state.phase='current-and-conformance-collected';state.performanceHistory='pending';state.completedAt=new Date().toISOString();await save();
}catch(error){state.phase='failed';state.error=error.message;state.stoppedAt=new Date().toISOString();await save();throw error;}
