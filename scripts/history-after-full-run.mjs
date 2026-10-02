import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {site,command} from './lib/wasmbench.mjs';

const ownerFile=resolve(process.argv[2]),directory=resolve(process.argv[3]);
await mkdir(directory,{recursive:true});
const owner=JSON.parse(await readFile(ownerFile));
if(!Number.isSafeInteger(owner.pid)||owner.pid<=1||owner.host!==process.platform+'/'+process.arch)throw Error('Invalid local full-run owner');
const state={schema:1,pid:process.pid,ownerPid:owner.pid,ownerFile,startedAt:new Date().toISOString(),phase:'waiting-current-run'};
async function save(){const path=join(directory,'status.json');await writeFile(path+'.tmp',JSON.stringify(state,null,2)+'\n');await rename(path+'.tmp',path);}
function ownerLive(){
  try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')return false;throw error;}
  try {
    const args=command('ps',['-p',String(owner.pid),'-o','args=']).toString();
    const live=args.includes('scripts/full-run.mjs');
    if(live){state.lastVerifiedLive=new Date().toISOString();delete state.lastObservationError;}
    return live;
  }catch(error){
    // A failed observation is not proof that the owner exited. Re-poll it.
    state.lastObservationError=error.message;return true;
  }
}
await save();
while(ownerLive()) {
  state.lastCheckedAt=new Date().toISOString();await save();
  await new Promise(resolve=>setTimeout(resolve,30_000));
}
state.phase='performance-history';state.startedHistoryAt=new Date().toISOString();await save();
const fd=openSync(join(directory,'collect.log'),'a');
const child=spawn(process.execPath,['scripts/performance-history-collect.mjs'],{cwd:site,env:process.env,stdio:['ignore',fd,fd]});
state.childPid=child.pid;await save();
const code=await new Promise((yes,no)=>{child.on('error',no);child.on('close',yes)});closeSync(fd);
state.exitCode=code;state.phase=code===0?'collected':'incomplete';state.completedAt=new Date().toISOString();await save();
process.exitCode=code || 0;
