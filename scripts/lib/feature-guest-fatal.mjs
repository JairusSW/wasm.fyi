import {readFile,readdir} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {workloadContract} from './workload-contract.mjs';
import {identifyEngineFatals} from './engine-fatal-reason.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Replay only retained evidence. A positive guest-native stack must match the
// exact capture, locked artifact, source revision, workload contract and phase.
export async function retainedFeatureGuestFatal({root,key,engine,workload,prior}) {
 if(engine!=='wago'||!/^[a-f0-9]{64}$/.test(key)||!prior?.capture||basename(prior.capture)!==prior.capture||prior.failure?.kind!=='failed-trials')return null;
 try {
  const sealed=[];
  const read=async path=>{const bytes=await readFile(path);sealed.push({path,sha256:hash(bytes)});return bytes;};
  const capture=JSON.parse(await read(join(root,'captures',prior.capture)));
  if(!isDeepStrictEqual(capture.source,prior.source)||!isDeepStrictEqual(prior.failure.source,prior.source))return null;
  if(!capture.results.length||capture.results.some(row=>row.engine!==engine||row.workload!==workload.id||row.artifactSha256!==workload.sha256||row.contractSha256!==workloadContract(workload)))return null;
  const producer=join(root,'compatibility',engine,key,'producer');
  const manifest=JSON.parse(await read(join(producer,'manifest.json')));
  const locked=manifest.lock.workloads,runtime=manifest.lock.runtime_configurations.find(row=>row.id===engine);
  if(locked.length!==1||locked[0].id!==workload.id||locked[0].sha256!==workload.sha256||workloadContract(locked[0])!==workloadContract(workload))return null;
  const version=runtime?.description?.runtime_version;
  if(version!==prior.source.revision&&!version?.startsWith(prior.source.revision+'/'))return null;
  const platform=capture.platform,host=manifest.host;
  if(platform.os!==host.os||platform.arch!==host.arch||platform.cpu!==host.cpu_description||platform.kernel!==host.kernel)return null;
  const trials=[];
  for(const name of await readdir(join(producer,'trials')))if(/^[\w.-]+\.json$/.test(name))trials.push(JSON.parse(await read(join(producer,'trials',name))));
  const classified=await identifyEngineFatals(trials,async path=>(await read(join(producer,path))).toString('utf8'));
  const failures=[];
  for(const failure of prior.failure.failures){
   if(!capture.results.some(row=>row.phase===failure.phase&&row.latencyStatus==='failed'))return null;
   const trial=classified.find(row=>row.runtime_configuration===engine&&row.workload===workload.id&&row.scenario===failure.phase&&row.status===failure.status&&row.originalReason===failure.reason);
   if(!trial)return null;
   failures.push({...failure,reason:trial.reason,originalReason:failure.reason});
  }
  if(!failures.length)return null;
  return {failure:{...prior.failure,failures,reason:failures.map(row=>row.reason).join('; '),originalReason:prior.failure.reason},evidence:{schema:1,classification:'retained-guest-native-fatal',engine,source:prior.source,workload:workload.id,artifactSha256:workload.sha256,contractSha256:workloadContract(workload),originalCapture:prior.capture,sealedFiles:sealed}};
 } catch { return null; }
}
