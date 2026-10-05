// Launch native AMD64 collection independently of the SSH connection.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,open,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {site} from './lib/wasmbench.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
const [previousArg,directoryArg,mode='start']=process.argv.slice(2);
assert(previousArg&&directoryArg,'Expected previous and next native snapshot directories');
const previous=resolve(previousArg),directory=resolve(directoryArg);
assert(process.platform==='linux'&&process.arch==='x64','Requires native Linux AMD64');
await mkdir(directory,{recursive:true});
const read=path=>readFile(path,'utf8').then(JSON.parse,()=>null);
const owner=pid=>{if(!Number.isInteger(pid)||pid<1)return false;try{const command=execFileSync('ps',['-p',String(pid),'-o','args='],{encoding:'utf8',stdio:['ignore','pipe','ignore']});return command.includes('weekly-next.mjs')&&command.includes(directory);}catch{return false;}};
const state=await read(join(directory,'weekly-run.json'));
const launch=await read(join(directory,'remote-launch.json'));
let log='';try{log=execFileSync('tail',['-n','4',join(directory,'weekly-run.log')],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{}
if(state?.status==='collected'||owner(state?.pid)||owner(launch?.pid)){
 console.log(JSON.stringify({active:owner(state?.pid)||owner(launch?.pid),state,log}));process.exit(0);
}
const warming=await read(join(directory,'warming.json'));
if(warming){let active=false;try{active=execFileSync('ps',['-p',String(warming.pid),'-o','args='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).includes(warming.argument);}catch{}
 if(active){console.log(JSON.stringify({active:true,warming:true,state}));process.exit(0);}}
if(mode==='status'){console.log(JSON.stringify({active:false,state,log}));process.exit(0);}
// A previous failed collector is resumable; completed corpus jobs stay sealed.
const fd=await open(join(directory,'background-native.log'),'a');
const child=spawn('flock',['-w','86400',resolve(directory,'../measurement.lock'),process.execPath,join(site,'scripts/weekly-next.mjs'),previous,directory],{cwd:site,detached:true,stdio:['ignore',fd.fd,fd.fd]});
await atomicJSON(join(directory,'remote-launch.json'),{pid:child.pid,started:new Date().toISOString()});
child.unref();await fd.close();
console.log(JSON.stringify({active:true,launched:true,pid:child.pid,state:null}));
