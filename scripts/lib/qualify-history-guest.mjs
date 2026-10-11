import {readFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJSON} from './benchmark-plan.mjs';
import {digest} from './wasmbench.mjs';
import {workloadContract} from './workload-contract.mjs';
import {startupLaunchCommand} from './sdk-startup.mjs';
export const guestPhases=['compile','first-call','instantiate','steady'];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const transportSha=workload=>digest(Buffer.from(JSON.stringify(canonical({original_contract:workload.original_contract,provenance:workload.provenance}))));
export function guestQualificationIdentity(source,configuration,controllerSha256,workload,runtime){
 if(!source?.revision||!runtime?.description?.backend)throw Error('Guest qualification requires pinned source and backend');
 return {revision:source.revision,configuration,controllerSha256,workloadId:workload.id,artifactSha256:workload.sha256,contractSha256:workloadContract(workload),transportSha256:transportSha(workload),backend:runtime.description.backend,runtimeFiles:runtime.file_sha256,effectiveConfiguration:runtime.description.effective_configuration};
}
export function validateGuestQualification(manifest,trials,identity){
 const runtime=manifest.lock?.runtime_configurations?.find(r=>r.id===identity.configuration);
 if(manifest.lock?.runner_sha256!==identity.controllerSha256||runtime?.description?.backend!==identity.backend||JSON.stringify(canonical(runtime.file_sha256))!==JSON.stringify(canonical(identity.runtimeFiles))||JSON.stringify(canonical(runtime.description.effective_configuration))!==JSON.stringify(canonical(identity.effectiveConfiguration)))throw Error('SDK guest qualification source/controller/backend identity changed');
 const workloads=manifest.lock.workloads||[],workload=workloads[0];
 if(workloads.length!==1||workload.id!==identity.workloadId||workload.sha256!==identity.artifactSha256||workloadContract(workload)!==identity.contractSha256||transportSha(workload)!==identity.transportSha256)throw Error('SDK guest qualification artifact or production workload contract changed');
 const options=manifest.lock.options;
 if(options.samples!==1||options.launches!==1||options.warmup!==0||options.adaptive_samples)throw Error('SDK guest qualification must collect one sample without warmup or adaptive groups');
 for(const phase of guestPhases){
  const rows=trials.filter(t=>t.profile==='timing'&&t.block>=0&&t.scenario===phase&&t.runtime_configuration===identity.configuration);
  if(rows.length!==1||rows[0].status!=='ok')throw Error('SDK guest qualification '+phase+' failed: '+(rows[0]?.reason||rows[0]?.error||rows[0]?.status||'missing phase'));
  if(rows[0].workload!==identity.workloadId)throw Error('SDK guest qualification trial workload changed');
  const samples=rows[0].samples||[];
  if(samples.length!==1||samples[0].warmup||samples[0].verified!==true||!Number.isSafeInteger(samples[0].elapsed_ns)||samples[0].elapsed_ns<0||samples[0].operations!==1)throw Error('SDK guest qualification requires one nonnegative verified sample for '+phase);
 }
 return true;
}
export async function qualifyHistoryGuest({directory,configuration,suite,harness,controller,source,runtime,env,run}){
 const workload=suite.find(w=>w.id==='wago/tiny/add');if(!workload)throw Error('Missing production Tiny corpus for SDK guest qualification');
 const identity=guestQualificationIdentity(source,configuration,digest(await readFile(controller)),workload,runtime);
 const key=digest(Buffer.from(JSON.stringify(identity))),root=env.WASMFYI_GUEST_QUALIFICATION_ROOT||join(directory,'sdk-guest-qualification'),receipt=join(root,key+'.json');await mkdir(root,{recursive:true});
 const existing=await readFile(receipt,'utf8').then(JSON.parse,()=>null);
 if(existing?.status==='passed'&&JSON.stringify(existing.identity)===JSON.stringify(identity))return existing;
 const suitePath=join(root,'tiny-'+key+'.json');await atomicJSON(suitePath,[workload]);
 const out=join(root,'tiny-'+key+'-'+randomUUID());
 const args=[controller,'run','--archive-tools=false','--suite',suitePath,'--runtimes',configuration,'--workers','1','--timeout','5m','--validation-profile','all','--profile','timing','--launches','1','--scenarios',guestPhases.join(','),'--samples','1','--samples-by-scenario',JSON.stringify(Object.fromEntries(['*',...guestPhases].map(p=>[p,1]))),'--operations','1','--warmup','0','--out',out];
 const launch=startupLaunchCommand(args,env.WASMFYI_STARTUP_CPU);
 // macOS exposes a foreground/performance policy hint, not hard CPU affinity.
 const command=process.platform==='darwin'&&env.WASMBENCH_SINGLE_CORE==='1'?['taskpolicy','-a','-t','0','-l','0',...launch]:launch;
 await run(command[0],command.slice(1),{cwd:harness,env,timeout:300000});
 const manifest=JSON.parse(await readFile(join(out,'manifest.json'))),trials=[];
 for(const file of await readdir(join(out,'trials')))if(file.endsWith('.json'))trials.push(JSON.parse(await readFile(join(out,'trials',file))));
 validateGuestQualification(manifest,trials,identity);
 const result={status:'passed',qualifiedAt:new Date().toISOString(),identity,output:out,phases:guestPhases,samplesPerPhase:1,warmup:0,adaptiveSampling:false,databasePublished:false};await atomicJSON(receipt,result);return result;
}
