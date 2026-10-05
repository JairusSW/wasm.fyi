// Finite, independently advancing ARM64/AMD64 historical backfill.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {open,readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {site,config} from './lib/wasmbench.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {runCommand,quote} from './lib/benchmark-process.mjs';
import {saturdays} from './lib/weekly-history.mjs';
import {historyDate} from './lib/history-align.mjs';
const [action='start',...args]=process.argv.slice(2);
assert(args.every(a=>a==='--deploy'),'Historical backfill accepts only --deploy; use status or stop for control');
const directory=join(site,'.wasmbench/history-background');await mkdir(directory,{recursive:true});
const stateFile=join(directory,'state.json'),log=join(directory,'progress.log');
const read=path=>readFile(path,'utf8').then(JSON.parse);
const prior=await read(stateFile).catch(()=>null);
const alive=pid=>{try{return execFileSync('ps',['-p',String(pid),'-o','args='],{encoding:'utf8'}).includes(resolve(process.argv[1])+' run');}catch{return false;}};
if(action==='status'){console.log(JSON.stringify(prior??{status:'not-started'},null,2));process.exit(0);}
if(action==='stop'){if(prior?.pid&&alive(prior.pid))process.kill(prior.pid,'SIGTERM');console.log('Stop requested; completed corpora are retained for resume.');process.exit(0);}
assert(['start','run'].includes(action),'Usage: weekly-background.mjs start|status|stop');
if(action==='start'){
 if(prior?.status==='running'&&alive(prior.pid)){console.log('Historical backfill already running: '+prior.pid);process.exit(0);}
 const fd=await open(log,'a');
 const child=spawn(process.execPath,[resolve(process.argv[1]),'run',...args],{cwd:site,detached:true,stdio:['ignore',fd.fd,fd.fd]});child.unref();await fd.close();
 console.log(`Historical backfill started (${child.pid}). Progress: ${log}`);process.exit(0);
}
if(prior?.status==='running'&&prior.pid!==process.pid&&alive(prior.pid))throw Error('Historical backfill supervisor already running');
const abort=new AbortController();let stopping=false;
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{
 if(stopping)return;stopping=true;
 try{
  const active=state.machines.hub.date;
  if(active){
   const native=remoteRoot+'/weekly-'+active.replaceAll('-','');
   const stopCode='import {readFile} from "node:fs/promises";import {execFileSync} from "node:child_process";const s=await readFile('+JSON.stringify(native+'/weekly-run.json')+').then(JSON.parse,()=>null),l=await readFile('+JSON.stringify(native+'/remote-launch.json')+').then(JSON.parse,()=>null);if(s?.status!=="collected")for(const pid of new Set([s?.pid,l?.pid].filter(Boolean)))try{const command=execFileSync("ps",["-p",String(pid),"-o","args="],{encoding:"utf8"});if(command.includes("weekly-next.mjs")&&command.includes('+JSON.stringify(native)+'))process.kill(pid,"SIGTERM");}catch{}';
   await runCommand('ssh',[...sshFlags,host.ssh,quote(remoteNode)+' --input-type=module -e '+quote(stopCode)]);
  }
 }catch(error){console.error('Remote stop:',error.message);}finally{abort.abort();}
});

const settings=await config(),host=settings.hosts.hub;
const remoteSite='/home/hub/.cache/wasm-fyi/weekly-20261003/site',remoteRoot='/home/hub/.cache/wasm-fyi',remoteNode='/home/hub/.cache/wasm-fyi/toolchains/node-v26.4.0-linux-x64/bin/node';
const socketDirectory=join(homedir(),'.ssh/controlmasters');await mkdir(socketDirectory,{recursive:true,mode:0o700});
const socket=join(socketDirectory,'wasm-fyi-hub');
const sshFlags=['-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ControlMaster=auto','-o','ControlPersist=yes','-o','ControlPath='+socket,'-o','ServerAliveInterval=30','-o','ServerAliveCountMax=6'];
const transport='ssh '+sshFlags.join(' '),sleep=async()=>{for(let i=0;i<30&&!abort.signal.aborted;i++)await new Promise(r=>setTimeout(r,1000));if(abort.signal.aborted)throw Error('Interrupted');};
const run=async(program,argv,opts={})=>{for(;;)try{return await runCommand(program,argv,{cwd:site,signal:abort.signal,onLine:line=>console.log(line),...opts});}catch(error){
 if(abort.signal.aborted||!(['ssh','rsync'].includes(program)&&/exited (255|12|30|35);/.test(error.message)))throw error;
 console.error('Transport interrupted; retaining the native job and retrying in 30 seconds:',error.message);await sleep();
}};
const ssh=(command,opts={})=>run('ssh',[...sshFlags,host.ssh,command],opts);
const script=(name,argv,opts={})=>run(process.execPath,[join(site,'scripts',name),...argv],opts);
const dates=prior?.dates??saturdays(new Date(),18).map(historyDate).reverse();
const state={schema:1,pid:process.pid,status:'running',scope:'historical-only',started:prior?.started??new Date().toISOString(),dates,publishEvery:2,machines:prior?.machines??{local:{previous:resolve('.wasmbench/weekly-20260926'),completed:[],failed:[]},hub:{previous:remoteRoot+'/weekly-20261003',completed:[],failed:[]}}};
let stateWrites=Promise.resolve();
const save=()=>{
 const snapshot=structuredClone({...state,updated:new Date().toISOString()});
 stateWrites=stateWrites.then(()=>atomicJSON(stateFile,snapshot));return stateWrites;
};await save();
if(process.platform==='darwin'){
 const awake=spawn('caffeinate',['-i','-w',String(process.pid)],{stdio:'ignore'});awake.on('error',error=>console.error('Idle sleep prevention:',error.message));awake.unref();
}
const measured=async(machine,date)=>{const timeline=await read(join(site,'data',machine==='local'?'history':'history-hub','weekly.json'));const point=timeline.results.find(w=>historyDate(w.targetWeek)===date);const calendar=await read(join(site,'data/history-calendar.json'));const week=calendar.weeks.find(w=>w.date===date);return !!point&&week?.pins.every(p=>p.status==='unavailable'?point.gaps?.[p.configurations[0]]:point.engines?.[p.configurations[0]]?.status==='measured');};
let publication=Promise.resolve();
const publish=machine=>{
 publication=publication.catch(error=>console.error('Previous publication checkpoint failed; retrying:',error.message)).then(async()=>{
  console.log(`Publication checkpoint: ${machine}, ${state.machines[machine].completed.length} new weekly snapshots`);
  await script('stage-data.mjs',[]);await script('view-data.mjs',[]);
  if(args.includes('--deploy'))await script('weekly-deploy.mjs',[]);
  state.machines[machine].lastPublished=new Date().toISOString();await save();
 });return publication;
};
try{
 // Every host receives the same resolved pins, including explicit upstream gaps.
 for(const date of dates){await script('weekly-plan.mjs',[date]);}
 await ssh('mkdir -p '+quote(remoteSite+'/data')+' '+quote(remoteSite+'/scripts/lib'));
 await run('rsync',['-az','-e',transport,join(site,'scripts/weekly-next.mjs'),join(site,'scripts/weekly-remote.mjs'),join(site,'scripts/weekly-queue.mjs'),join(site,'scripts/weekly-collect.mjs'),join(site,'scripts/weekly-build.mjs'),join(site,'scripts/weekly-repair.mjs'),join(site,'scripts/weekly-retire.mjs'),join(site,'scripts/weekly-publish.mjs'),host.ssh+':'+remoteSite+'/scripts/']);
 await run('rsync',['-az','-e',transport,join(site,'scripts/lib/weekly-calendar.mjs'),join(site,'scripts/lib/wago-legacy.mjs'),join(site,'scripts/lib/weekly-parity.mjs'),join(site,'scripts/lib/snapshot-index.mjs'),join(site,'scripts/lib/validate-data.mjs'),host.ssh+':'+remoteSite+'/scripts/lib/']);
 await run('rsync',['-az','-e',transport,join(site,'data/history-calendar.json'),host.ssh+':'+remoteSite+'/data/']);
 const work=async machine=>{
  const progress=state.machines[machine];
  for(const date of dates){
   if(progress.completed.includes(date)||await measured(machine,date)||progress.failed.some(f=>f.date===date))continue;
   const week='weekly-'+date.replaceAll('-',''),native=machine==='local'?resolve('.wasmbench/'+week):remoteRoot+'/'+week,local=machine==='local'?native:resolve('.wasmbench/'+week+'/hub');
   progress.date=date;progress.status='waiting';await save();
   try{
    if(machine==='hub'){
     if(date!=='2026-09-26'){
      await ssh('mkdir -p '+quote(native));await run('rsync',['-az','-e',transport,join(local,'pins.json'),host.ssh+':'+native+'/pins.json']);
      await ssh('cd '+quote(remoteSite)+' && '+quote(remoteNode)+' scripts/weekly-queue.mjs '+quote(progress.previous)+' '+quote(native));
     }
     progress.status='collecting';await save();
     const remote=mode=>ssh('cd '+quote(remoteSite)+' && flock -w 60 '+quote(native+'/launch.lock')+' '+quote(remoteNode)+' scripts/weekly-remote.mjs '+quote(progress.previous)+' '+quote(native)+' '+mode);
     let current=JSON.parse((await remote('start')).output);
     let lastLog='';
     while(current.active){
      if(current.log&&current.log!==lastLog){console.log(`AMD64 ${date}:\n${current.log}`);lastLog=current.log;}
      await sleep();current=JSON.parse((await remote(current.warming?'start':'status')).output);
     }
     assert.equal(current.state?.status,'collected','AMD native capture stopped: '+(current.state?.reason??current.state?.status));
    }else{
     // A coordinator restart must adopt surviving native work, not duplicate it.
     const activeNative=pid=>{if(!Number.isInteger(pid))return false;try{const command=execFileSync('ps',['-p',String(pid),'-o','args='],{encoding:'utf8',stdio:['ignore','pipe','ignore']});return command.includes('weekly-next.mjs')&&command.includes(native);}catch{return false;}};
     let existing=await read(join(native,'weekly-run.json')).catch(()=>null);
     while(activeNative(existing?.pid)){progress.status='collecting';await save();await sleep();existing=await read(join(native,'weekly-run.json')).catch(()=>null);}
     if(existing?.status!=='collected'){
      await script('weekly-queue.mjs',[progress.previous,native]);progress.status='collecting';await save();
      await script('weekly-next.mjs',[progress.previous,native],{log:join(native,'background-native.log')});
     }
    }
    if(machine==='hub'){
     // Ship only sealed corpus reports, parent bundles and receipts, not SDK caches.
     await mkdir(local,{recursive:true});
     await run('rsync',['-az','-e',transport,'--include=sessions/***','--include=*-build.json','--include=*-build.log','--include=pins.json','--include=reuse.json','--include=harness-pin.json','--include=suite.json','--include=weekly-run.json','--include=weekly-run.log','--exclude=*',host.ssh+':'+native+'/',local+'/']);
     const reuse=await read(join(local,'reuse.json'));for(const entry of reuse.reused)entry.from=resolve('.wasmbench/'+(entry.from??reuse.from).split('/').at(-1)+'/hub');reuse.from=resolve('.wasmbench/'+reuse.from.split('/').at(-1)+'/hub');await atomicJSON(join(local,'reuse.json'),reuse);
     await script('weekly-publish.mjs',[local,machine]);
    }
    // The native collector has released this host. Repair an existing Wago
    // build gap here so timing never overlaps another weekly capture.
    if(machine==='local')await script('weekly-repair.mjs',[native]);
    else {
     await ssh('cd '+quote(remoteSite)+' && flock -w 60 '+quote(remoteRoot+'/measurement.lock')+' '+quote(remoteNode)+' scripts/weekly-repair.mjs '+quote(native));
     const repairs=JSON.parse((await ssh('cat '+quote(remoteRoot+'/history-repairs.json')+' 2>/dev/null || echo \'{"weeks":[]}\'')).output);
     for(const repaired of repairs.weeks){
      assert(/^weekly-\d{8}$/.test(repaired),'Unsafe repaired week');
      const from=remoteRoot+'/'+repaired,to=resolve('.wasmbench/'+repaired+'/hub');await mkdir(to,{recursive:true});
      await run('rsync',['-az','-e',transport,'--include=sessions/***','--include=*-build.json','--include=pins.json','--include=suite.json','--include=weekly-run.json','--exclude=*',host.ssh+':'+from+'/',to+'/']);
      await script('weekly-publish.mjs',[to,machine,'wago']);
     }
    }
    if(date<'2026-09-26'){
     if(machine==='local')await script('weekly-retire.mjs',[native]);
     else await ssh('cd '+quote(remoteSite)+' && '+quote(remoteNode)+' scripts/weekly-retire.mjs '+quote(native));
    }
    const nativeState=machine==='local'?await read(join(native,'weekly-run.json')):JSON.parse((await ssh('cat '+quote(native+'/weekly-run.json'))).output);
    const gaps=Object.entries(nativeState.engines).filter(([,e])=>['unavailable','build-failed','qualification-failed'].includes(e.status));
    if(gaps.length){progress.gaps??=[];progress.gaps.push({date,engines:Object.fromEntries(gaps)});}
    progress.previous=native;if(!progress.completed.includes(date))progress.completed.push(date);progress.status='completed';await save();
    if(progress.completed.length%state.publishEvery===0)try{await publish(machine);}catch(error){progress.publicationErrors??=[];progress.publicationErrors.push({date,reason:error.message});await save();}
   }catch(error){
    if(abort.signal.aborted)throw error;
    progress.failed.push({date,reason:error.message,recordedAt:new Date().toISOString()});progress.status='failed-week';await save();console.error(`${machine} ${date}: ${error.message}; evidence retained, next week remains queued`);
   }
  }
  if(progress.completed.length%state.publishEvery)try{await publish(machine);}catch(error){progress.publicationErrors??=[];progress.publicationErrors.push({reason:error.message});await save();}
  progress.status='finished';delete progress.date;await save();
 };
 const jobs=await Promise.allSettled(['local','hub'].map(work));
 for(const job of jobs)if(job.status==='rejected')throw job.reason;
 await publication;state.status=state.machines.local.failed.length||state.machines.hub.failed.length||state.machines.local.gaps?.length||state.machines.hub.gaps?.length||state.machines.local.publicationErrors?.length||state.machines.hub.publicationErrors?.length?'completed-with-gaps':'completed';await save();
 console.log('Historical backfill finished; no future Saturday runs are scheduled.');
}catch(error){state.status=abort.signal.aborted?'paused':'failed';state.reason=error.message;await save();throw error;}
