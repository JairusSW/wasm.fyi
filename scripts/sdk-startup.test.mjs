import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkSDKStartup,startupLaunchCommand} from './lib/sdk-startup.mjs';

test('startup qualification requests only describe/close and retains actual SDK metadata',async()=>{
 const child=`import readline from 'node:readline';const seen=[];for await(const line of readline.createInterface({input:process.stdin})){const r=JSON.parse(line);if(!Number.isSafeInteger(r.id)||r.id<0)process.exit(71);seen.push([r.id,r.method]);if(r.method==='describe')console.log(JSON.stringify({version:1,id:r.id,description:{runtime:'fixture',runtime_version:'source-hash',backend:'interpreter',build:'source-hash'}}));else if(r.method==='close'){if(JSON.stringify(seen)!=='[[1,"describe"],[2,"close"]]')process.exit(7);process.exit(0);}else process.exit(8);}`;
 const result=await checkSDKStartup([process.execPath,'--input-type=module','-e',child]);
 assert.equal(result.description.runtime_version,'source-hash');
 assert.equal(result.description.backend,'interpreter');
});
test('startup loader errors and malformed metadata fail before any corpus capture',async()=>{
 await assert.rejects(checkSDKStartup([process.execPath,'-e','console.error("missing shared library");process.exit(78)']),/78; stderr: missing shared library/);
 await assert.rejects(checkSDKStartup([process.execPath,'-e','console.log(JSON.stringify({version:1,id:1,description:{}}))']),/description lacks runtime/);
});
test('native structured rejection preserves the original SDK reason',async()=>{
 await assert.rejects(checkSDKStartup([process.execPath,'-e','console.log(JSON.stringify({version:1,id:1,status:"error",reason:"invalid protocol envelope"}))']),/SDK rejected describe: invalid protocol envelope/);
});
test('silent startup hangs are bounded and terminated',async()=>{
 await assert.rejects(checkSDKStartup([process.execPath,'-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{timeoutMs:100}),/timed out after 100 ms/);
});

test('startup pin applies to actual SDK launch without changing source-bound command',()=>{const command=Object.freeze(['/sdk/java','-Xbatch','Adapter']);assert.deepEqual(startupLaunchCommand(command,'2','linux'),['taskset','-c','2',...command]);assert.deepEqual(command,['/sdk/java','-Xbatch','Adapter']);assert.deepEqual(startupLaunchCommand(command,undefined,'darwin'),command);for(const cpu of ['2,3','-1','2;echo','1-3','02'])assert.throws(()=>startupLaunchCommand(command,cpu,'linux'),/one nonnegative/);assert.throws(()=>startupLaunchCommand(command,'2','darwin'),/Linux taskset/);});

test('Linux taskset actually pins metadata children on the installed util-linux CLI',{skip:process.platform!=='linux'},async()=>{const status=await readFile('/proc/self/status','utf8');const cpu=status.match(/^Cpus_allowed_list:\s*(\d+)/m)?.[1];assert.ok(cpu);const child=`const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const r=JSON.parse(line);if(r.method==='describe')console.log(JSON.stringify({version:1,id:r.id,description:{runtime:'fixture',runtime_version:'source-hash',backend:'interpreter',build:'source-hash',cpu:fs.readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\\s*(.+)$/m)[1]}}));else if(r.method==='close')process.exit(0);});`;const result=await checkSDKStartup([process.execPath,'-e',child],{cpu});assert.equal(result.description.cpu,cpu);assert.equal(result.executionCPU,Number(cpu));});
