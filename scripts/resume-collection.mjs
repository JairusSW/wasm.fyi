// Finish a sealed timing collection without rebuilding or changing its engines.
import {readFile,writeFile,mkdir,rename,statfs} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {harness,command,digest,locked} from './lib/wasmbench.mjs';
import {assertRecoveryCohort} from './lib/collection-recovery.mjs';
const timing=resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Usage: node scripts/resume-collection.mjs <sealed timing bundle>');
const {root,run}=await harness();
const directory=dirname(timing),folder=join(directory,'recovery');await mkdir(folder,{recursive:true});
const state={schema:1,pid:process.pid,host:process.platform+'/'+process.arch,startedAt:new Date().toISOString(),timing,phase:'verify',steps:[]};
async function save(){const path=join(folder,'status.json');await writeFile(path+'.tmp',JSON.stringify(state,null,2)+'\n');await rename(path+'.tmp',path);}
const invoke=(...args)=>process.stdout.write(run(...args));
await locked(async()=>{
await save();
try {
 invoke('verify','--run',timing);
 const manifest=JSON.parse(await readFile(join(timing,'manifest.json'))),lock=manifest.lock;
 if(lock.options.profile!=='timing')throw Error('Recovery requires a timing bundle');
 state.originalSealSha256=digest(await readFile(join(timing,'checksums.json')));
 // Resolve shells from the original locked commands rather than PATH.
 for(const [id,name] of [['spidermonkey','WASMBENCH_SPIDERMONKEY'],['deno','WASMBENCH_DENO']]) {
  const runtime=lock.runtime_configurations.find(r=>r.id===id);if(runtime)process.env[name]=runtime.command[0];
 }
 const suite=lock.options.suite;
 const shared=['--archive-tools=true','--suite',suite,'--runtimes',lock.runtime_configurations.map(r=>r.id).join(','),'--timeout','300s','--validation-profile','all'];
 const reports=['report','--run',timing];
 for(const profile of ['memory','code']) {
  const space=await statfs(folder);if(Number(space.bavail)*Number(space.bsize)<20*1024**3)throw Error('Less than 20 GiB free before recovery pass');
  state.phase=profile;await save();
  const plan=join(folder,profile+'-plan-'+process.pid+'.json');
  invoke('plan',...shared,'--profile',profile,'--out',plan);
  const planned=JSON.parse(await readFile(plan));
  for(const runtime of planned.runtime_configurations) {
   const response=JSON.parse(command(runtime.command[0],runtime.command.slice(1),{cwd:root,input:'{"version":1,"id":1,"method":"describe"}\n',timeout:30_000}).toString());
   runtime.description=response.description;
   // These extra Java diagnostics are omitted by the harness's typed
   // Description decoder. The exact Java executable is still hash-locked.
   delete runtime.description.java_vm;delete runtime.description.java_version;
  }
  const identity=r=>({id:r.id,command:r.command,file_sha256:r.file_sha256,description:r.description});
  if(!isDeepStrictEqual(planned.runtime_configurations.map(identity),lock.runtime_configurations.map(identity)))throw Error('Adapter identity changed since the timing pass');
  assertRecoveryCohort(planned.workloads,lock.workloads);
  const output=join(folder,profile+'-'+process.pid);
  const args=['run',...shared,'--profile',profile,'--launches',String(profile==='code'?1:lock.options.launches),'--samples','1','--operations','1','--warmup','0','--out',output];
  if(profile==='code')args.push('--scenarios','compile');
  if(profile==='memory'&&lock.options.phase_barriers)args.push('--phase-barriers');
  const entry={profile,output,status:'running',startedAt:new Date().toISOString()};state.steps.push(entry);await save();
  let failure;try{invoke(...args);}catch(error){failure=error.message;}
  invoke('verify','--run',output);
  entry.status='verified';entry.trialFailure=failure;entry.completedAt=new Date().toISOString();await save();
  reports.push(profile==='memory'?'--memory-run':'--code-run',output);
 }
 const report=join(folder,'report-'+process.pid);invoke(...reports,'--out',report);invoke('verify-report','--dir',report);
 state.report=report;state.phase='collected';state.completedAt=new Date().toISOString();await save();
}catch(error){state.phase='failed';state.reason=error.message;state.completedAt=new Date().toISOString();await save();throw error;}

},'collection-recovery');
