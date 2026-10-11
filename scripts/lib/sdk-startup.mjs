import {spawn} from 'node:child_process';

export function startupLaunchCommand(command,cpu,platform=process.platform) {
 if(cpu===undefined||cpu===null||cpu==='')return [...command];
 if(!/^(?:0|[1-9][0-9]*)$/.test(String(cpu)))throw Error('SDK startup CPU must be one nonnegative core number');
 if(platform!=='linux')throw Error('SDK startup CPU pin requires Linux taskset');
 return ['taskset','-c',String(cpu),...command];
}

// This requests metadata only. It never prepares or invokes a corpus artifact.
export async function checkSDKStartup(command,{cwd,env=process.env,timeoutMs=30000,cpu=env.WASMFYI_STARTUP_CPU}={}) {
 if(!Array.isArray(command)||!command.length||command.some(x=>typeof x!=='string'))throw Error('SDK startup command is invalid');
 const launch=startupLaunchCommand(command,cpu);
 return new Promise((resolve,reject)=>{
  const child=spawn(launch[0],launch.slice(1),{cwd,env,detached:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',failure=null,force;
  const kill=signal=>{if(child.pid)try{process.kill(-child.pid,signal)}catch(error){if(error.code!=='ESRCH')throw error}};
  const cancel=reason=>{
   if(failure)return;failure=reason;kill('SIGTERM');
   force=setTimeout(()=>kill('SIGKILL'),250);
  };
  const timer=setTimeout(()=>cancel('SDK startup timed out after '+timeoutMs+' ms'),timeoutMs);
  child.stdout.on('data',data=>{if(stdout.length+data.length>1024*1024)cancel('SDK startup response exceeds 1 MiB');else stdout+=data;});
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-16384);});
  child.stdin.on('error',()=>{}); // An early loader failure closes the pipe.
  child.stdin.end(JSON.stringify({version:1,id:1,method:'describe'})+'\n'+JSON.stringify({version:1,id:2,method:'close'})+'\n');
  child.on('error',error=>{clearTimeout(timer);if(force)clearTimeout(force);reject(error);});
  child.on('close',(code,signal)=>{
   clearTimeout(timer);
   if(!failure&&force)clearTimeout(force);
   const diagnostic=stderr?'; stderr: '+stderr:'';
   if(failure)return reject(Error(failure+diagnostic));
   if(code!==0)return reject(Error('SDK terminated before startup qualification: '+(signal||code)+diagnostic));
   try {
    const replies=stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const reply=replies.find(row=>row.id===1);
    if(reply?.error||(reply?.status&&reply.status!=='ok'))throw Error('SDK rejected describe: '+(reply.reason||JSON.stringify(reply.error)||reply.status));
    if(reply?.version!==1||reply.error||!reply.description||typeof reply.description!=='object')throw Error('SDK describe response is missing or invalid');
    for(const field of ['runtime','runtime_version','backend','build'])if(typeof reply.description[field]!=='string'||!reply.description[field])throw Error('SDK description lacks '+field);
    resolve({qualifiedAt:new Date().toISOString(),command,description:reply.description,scope:'Metadata describe/close; no workload preparation or invocation',...(cpu!==undefined&&cpu!==null&&cpu!==''?{executionCPU:Number(cpu),affinity:'taskset'}:{})});
   }catch(error){reject(Error('SDK startup qualification failed: '+error.message+diagnostic));}
  });
 });
}
