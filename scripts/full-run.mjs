import{latestReports}from'./lib/latest-reports.mjs';
import{mkdir,readFile,writeFile,rename}from'node:fs/promises';
import{join,resolve}from'node:path';
import{spawn}from'node:child_process';
import{openSync,closeSync}from'node:fs';
import{config,site}from'./lib/wasmbench.mjs';
import{featureConfigurations}from'./lib/feature-configurations.mjs';
const directory=resolve(process.argv[2] || join(site,'.wasmbench/full-run'));
await mkdir(directory,{recursive:true});
const settings=await config(),runtimes=process.env.WASMBENCH_RUNTIMES?.split(',')||featureConfigurations(settings);
const historyWeeks=Number(process.env.WASMBENCH_FULL_HISTORY_WEEKS||18);
const historyAuthorized=process.env.WASMBENCH_RUN_HISTORY==='1'&&process.env.WASMBENCH_HOLD_HISTORY!=='1';
const suite=process.env.WASMBENCH_FULL_SUITE||'wago';
const hubStage=process.env.WASMBENCH_HUB_STAGE?.trim()||'';
if(!['wago','all'].includes(suite))throw Error('WASMBENCH_FULL_SUITE must be wago or all');
if(!Number.isSafeInteger(historyWeeks)||historyWeeks<1||historyWeeks>53)throw Error('WASMBENCH_FULL_HISTORY_WEEKS must be 1..53');
if(hubStage&&!/^hub-[a-zA-Z0-9-]+$/.test(hubStage))throw Error('WASMBENCH_HUB_STAGE must be a staged Hub experiment ID');
const state={schema:1,pid:process.pid,startedAt:new Date().toISOString(),host:process.platform+'/'+process.arch,phase:'starting',runtimes,suite,historyWeeks,steps:[]};
if(hubStage)state.hubStage=hubStage;
let saveChain=Promise.resolve();
async function save(){saveChain=saveChain.then(async()=>{const path=join(directory,'status.json');await writeFile(path+'.tmp',JSON.stringify(state,null,2)+'\n');await rename(path+'.tmp',path);});return saveChain;}
async function step(name,args,extra={},allowIncomplete=false){
 state.phase=name;const entry={name,startedAt:new Date().toISOString(),status:'running',log:join(directory,name+'.log')};state.steps.push(entry);await save();
 const fd=openSync(entry.log,'a');const child=spawn(process.execPath,args,{cwd:site,stdio:['ignore',fd,fd],env:{...process.env,...extra}});entry.pid=child.pid;await save();
 const code=await new Promise((yes,no)=>{child.on('error',no);child.on('close',yes)});closeSync(fd);entry.status=code===0?'passed':allowIncomplete?'incomplete':'failed';entry.exitCode=code;entry.completedAt=new Date().toISOString();await save();if(code!==0&&!allowIncomplete)throw Error(name+' failed; inspect '+entry.log);return code;
}
await save();
try{
 const env={WASMBENCH_SUITE:suite,WASMBENCH_RUNTIMES:runtimes.join(','),WASMBENCH_VALIDATION_PROFILE:'all',WASMBENCH_RECORD_FAILURES:'1',WASMBENCH_TIMEOUT:'300s',WASMBENCH_WORKERS:process.env.WASMBENCH_WORKERS||'3',WASMBENCH_SKIP_HARNESS_PATCH:'1'};
 const hubEnv={...env,WASMBENCH_RUNTIMES:process.env.WASMBENCH_RUNTIMES||featureConfigurations(settings,'linux').join(','),WASMBENCH_JSC:process.env.WASMBENCH_JSC_HUB||env.WASMBENCH_JSC};
 await step('build',['scripts/bench.mjs','build'],env);
 const auditRuntimes=runtimes.filter(id=>['wago','wazero'].includes(id));
 if(auditRuntimes.length) {
 const auditEnv={WASMBENCH_AUDIT_RUNTIMES:auditRuntimes.join(',')};
 const auditOutcomes=await Promise.allSettled([step('compile-latency-audit-mac',['scripts/compile-latency-audit.mjs'],auditEnv),step('compile-latency-audit-hub',['scripts/hub.mjs','compile-audit',...(hubStage?[hubStage]:[])],{...hubEnv,...auditEnv})]);
 const auditFailures=auditOutcomes.map((result,index)=>result.status==='rejected'?{name:index===0?'compile-latency-audit-mac':'compile-latency-audit-hub',error:result.reason?.message||String(result.reason)}:null).filter(Boolean);
 if(auditFailures.length)throw Error('Independent compile-latency audit incomplete: '+JSON.stringify(auditFailures));
 }
 if(process.env.WASMBENCH_SKIP_LATEST!=='1') {
  state.phase='collecting-mac-and-hub';await save();
  const outcomes=await Promise.allSettled([step('collect-mac',['scripts/bench.mjs','collect'],env),step('collect-hub',['scripts/hub.mjs','collect',...(hubStage?[hubStage]:[])],hubEnv)]);
  const failures=outcomes.map((result,index)=>result.status==='rejected'?{name:index===0?'collect-mac':'collect-hub',error:result.reason?.message||String(result.reason)}:null).filter(Boolean);
  if(failures.length)throw Error('Latest collection incomplete: '+JSON.stringify(failures));
 } else {
  const local=await readFile(join(site,'.wasmbench/latest-report.txt'),'utf8').then(value=>value.trim(),()=>null);
  const hub=await readFile(join(site,'.wasmbench/latest-hub-report.txt'),'utf8').then(value=>value.trim(),()=>null);
  if(!local||!hub)throw Error('WASMBENCH_SKIP_LATEST requires verified Mac and Hub latest reports');
  state.skippedLatestCollection={mac:local,hub};await save();
 }
 const report=(await readFile(join(site,'.wasmbench/latest-report.txt'),'utf8')).trim();state.report=report;await save();
 if(!historyAuthorized) {
  const hubReport=(await readFile(join(site,'.wasmbench/latest-hub-report.txt'),'utf8')).trim();
  state.historyStatus='held-pending-explicit-authorization';await save();
  await step('update-website',['scripts/update-data.mjs','--append','--rebuild',report,hubReport],{});
  state.phase='latest-data-complete-history-held';state.completedAt=new Date().toISOString();await save();
 } else {
  await step('history-plan',['scripts/history.mjs','plan'],{WASMBENCH_HISTORY_WEEKS:String(historyWeeks)});
  await step('history-conformance',['scripts/history.mjs','collect'],{WASMBENCH_HISTORY_WEEKS:String(historyWeeks)});
  await step('performance-history-plan',['scripts/performance-history.mjs','plan'],{WASMBENCH_PERFORMANCE_HISTORY_WEEKS:String(historyWeeks)});
  state.phase='collecting-release-history-mac-and-hub';await save();
  const historyCodes=await Promise.all([step('performance-history-mac',['scripts/performance-history-collect.mjs'],{WASMBENCH_PERFORMANCE_HISTORY_WEEKS:String(historyWeeks),WASMBENCH_HISTORY_PLAN_READY:'1'},true),
    step('performance-history-hub',['scripts/hub.mjs','performance-history',...(hubStage?[hubStage]:[])],{...hubEnv,WASMBENCH_PERFORMANCE_HISTORY_WEEKS:String(historyWeeks)},true)]);
  await step('update-website',['scripts/update-data.mjs'],{});
  state.phase=historyCodes.some(code=>code!==0)?'complete-with-history-gaps':'complete';state.performanceHistory=historyCodes.some(code=>code!==0)?'incomplete-with-explicit-gaps':'collected';state.completedAt=new Date().toISOString();await save();
 }
}catch(error){state.phase='failed';state.error=error.message;state.stoppedAt=new Date().toISOString();await save();throw error;}
