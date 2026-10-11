import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {runBenchmarkProcess} from './lib/benchmark-process.mjs';

test('controller errors are retained and successful processes finish',async()=>{
 await runBenchmarkProcess(process.execPath,['-e','process.exit(0)']);
 await assert.rejects(runBenchmarkProcess(process.execPath,['-e','console.error("adapter failed");process.exit(2)']),/adapter failed/);
});

test('deadline kills descendants even when the controller exits first',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wasmfyi-watchdog-'));
 const file=join(directory,'child.pid');
 const source=`const {spawn}=require('node:child_process'); const fs=require('node:fs');const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000);`;
 const abort=new AbortController();
 const result=runBenchmarkProcess(process.execPath,['-e',source,file],{signal:abort.signal});
 let pid;
 try{
  for(let i=0;i<100&&!pid;i++){pid=Number(await readFile(file,'utf8').catch(()=>''));if(!pid)await delay(20)}
  assert(pid,'descendant started');await delay(150);
  abort.abort(Error('five-minute workload deadline'));
  await assert.rejects(result,/workload deadline/);
  await delay(2200);
  // A zombie is already terminated but can remain visible until reaped.
  const {execFileSync}=await import('node:child_process');
  let state='';try{state=execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'}).trim()}catch{}
  assert(!state||state.startsWith('Z'),`descendant still running: ${state}`);
 }finally{
  if(pid)try{process.kill(pid,'SIGKILL')}catch{}
  await rm(directory,{recursive:true,force:true});
 }
});
