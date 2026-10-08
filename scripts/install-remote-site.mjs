// Deployment compilation shares the benchmark host's build/measurement lock.
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {acquireMeasurementLock} from '/root/.cache/wasm-fyi/site/scripts/lib/measurement-lock.mjs';
const releaseDirectory=process.argv[2];
if(!releaseDirectory?.startsWith('/opt/wasmfyi/releases/'))throw Error('Staged release is required');
const abort=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>abort.abort());
const prebuilt=await access(releaseDirectory+'/wasmfyi',constants.X_OK).then(()=>true,()=>false);
console.log(prebuilt?'Installing prebuilt release; no compilation on Remote':'Waiting for Remote build/measurement lock');
const release=prebuilt?async()=>{}:await acquireMeasurementLock('/root/.cache/wasm-fyi/release-five-20261008/measurement-lock',abort.signal);
try {
 console.log(prebuilt?'Configuring production services on CPUs 0–1':'Installing and building remote site under exclusive host lock');
 await new Promise((ok,fail)=>{
  const child=spawn('taskset',['-c',prebuilt?'0,1':'3,4','bash',releaseDirectory+'/source/scripts/install-remote-site.sh',releaseDirectory],{stdio:'inherit',detached:true});
  const cancel=()=>{try{process.kill(-child.pid,'SIGTERM')}catch(error){if(error.code!=='ESRCH')throw error}};
  abort.signal.addEventListener('abort',cancel,{once:true});
  if(abort.signal.aborted)cancel();
  child.on('error',fail);child.on('exit',code=>{abort.signal.removeEventListener('abort',cancel);code===0?ok():fail(Error('Site installation exited '+code))});
 });
} finally {await release()}
