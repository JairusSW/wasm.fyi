import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,readFile,rm,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{withBuildReserve}from'./lib/build-capacity.mjs';import{runCommand}from'./lib/benchmark-process.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function identity(pid){try{const s=await readFile('/proc/'+pid+'/stat','utf8');const fields=s.split(') ')[1].split(' ');return{start:fields[19],state:fields[0]}}catch(e){if(e.code==='ENOENT')return null;throw e}}
test('SDK capacity cancellation kills a SIGTERM-ignoring descendant after leader exit',{skip:process.platform!=='linux',timeout:12000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wasmfyi-capacity-abort-')),leader=join(dir,'leader.json'),grandchild=join(dir,'child.json');let owner,child;
 const childSource=`const fs=require('node:fs');process.on('SIGTERM',()=>{});const f=fs.readFileSync('/proc/'+process.pid+'/stat','utf8').split(') ')[1].split(' ');fs.writeFileSync(${JSON.stringify(grandchild)},JSON.stringify({pid:process.pid,start:f[19]}));setInterval(()=>{},1000);`;
 const source=`const fs=require('node:fs');const f=fs.readFileSync('/proc/'+process.pid+'/stat','utf8').split(') ')[1].split(' ');fs.writeFileSync(${JSON.stringify(leader)},JSON.stringify({pid:process.pid,start:f[19]}));require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
 const env={...process.env,WASMFYI_BUILD_MIN_FREE_BYTES:'100',WASMFYI_BUILD_GROWTH_BYTES_BY_ENGINE:JSON.stringify({v8:50,jsc:150,graalwasm:80})};
 const io={statfs:async()=>({bavail:BigInt(await readFile(grandchild).then(()=>99,()=>200)),bsize:1n}),writeFile};
 try{
  await assert.rejects(withBuildReserve(dir,'v8',env,signal=>runCommand(process.execPath,['-e',source],{signal,env}),io,10),e=>e.code==='WASMFYI_DISK_CAPACITY');
  owner=JSON.parse(await readFile(leader));child=JSON.parse(await readFile(grandchild));
  const started=Date.now();while(Date.now()-started<4500){const actual=await identity(child.pid);if(!actual||actual.state==='Z')break;assert.equal(actual.start,child.start);await sleep(25)}
  const actual=await identity(child.pid);assert.ok(!actual||actual.state==='Z','SIGTERM-ignoring child survived escalation');
  const receipt=JSON.parse(await readFile(join(dir,'build-capacity-growth.json')));assert.equal(receipt.status,'growth-exhausted-reserve');
 }finally{
  for(const file of[leader,grandchild]){const saved=await readFile(file,'utf8').then(JSON.parse,()=>null);if(!saved)continue;const actual=await identity(saved.pid);if(actual?.start===saved.start&&actual.state!=='Z')try{process.kill(saved.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}}
  await rm(dir,{recursive:true,force:true});
 }
});
test('normal successful SDK command remains unchanged',{timeout:3000},async()=>{const value=await runCommand(process.execPath,['-e','process.stdout.write("normal-sdk")']);assert.equal(value.code,0);assert.equal(value.output,'normal-sdk');});
