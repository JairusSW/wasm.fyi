import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {acquireMeasurementLock} from './measurement-lock.mjs';
const execute=promisify(execFile);
// A watcher skips an occupied host. Reading an owner file never grants a lease.
export async function linkAliasesWhenIdle(root,{command,queueTimeoutMs=50,commandTimeoutMs=45000}={}){
 let release;
 try{release=await acquireMeasurementLock(join(root,'measurement-lock'),AbortSignal.timeout(queueTimeoutMs))}
 catch(error){if(error.name==='TimeoutError'||error.name==='AbortError')return{occupied:true,exitCode:75};throw error}
 try{const [program,...args]=command;await execute(program,args,{timeout:commandTimeoutMs,killSignal:'SIGKILL',maxBuffer:1024*1024});return{occupied:false,exitCode:0}}
 finally{await release()}
}
