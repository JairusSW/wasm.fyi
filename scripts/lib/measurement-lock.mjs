import {mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Builders and collectors on one host share this directory. SDK compilation
// and measurements are mutually exclusive; measurements also run one at a time.
export async function acquireMeasurementLock(path,signal) {
 const owner=join(path,'owner');
 for(;;) {
  signal?.throwIfAborted();
  try {
   await mkdir(path);
   await writeFile(owner,String(process.pid));
   return async()=>{if(await readFile(owner,'utf8').catch(()=>null)===String(process.pid))await rm(path,{recursive:true,force:true});};
  } catch(error) {
   if(error.code!=='EEXIST')throw error;
   const pid=Number(await readFile(owner,'utf8').catch(()=>''));
   let alive=true;
   if(pid>0){try{process.kill(pid,0)}catch(e){if(e.code==='ESRCH')alive=false;else if(e.code!=='EPERM')throw e;}}
   else {const info=await stat(path).catch(()=>null);alive=info&&Date.now()-info.mtimeMs<30000;}
   if(!alive){
    const reclaim=path+'-reclaim';
    try {
     await mkdir(reclaim);
     try {if(Number(await readFile(owner,'utf8').catch(()=>''))===pid)await rm(path,{recursive:true,force:true});}
     finally {await rm(reclaim,{recursive:true,force:true});}
    } catch(e){if(e.code!=='EEXIST')throw e;}
    continue;
   }
   await delay(250,undefined,{signal});
  }
 }
}

/** Run SDK preparation under the same exclusion lock as timing collection. */
export async function withBuildLock(root, action) {
 const release = await acquireMeasurementLock(join(root, "measurement-lock"));
 try { return await action(); } finally { await release(); }
}
