import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {workloadContract} from './workload-contract.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const termination=/^(?:(?:sacrificial check [a-zA-Z0-9_-]+|adaptive phase (?:compile|instantiate|first-call|steady)): )?adapter terminated before response \(see trial log\)$/;
export function qualifiedEngineFatal(error,done,proof,readBytes=readFileSync){
 try{
  const i=proof.identity;
  if(proof.schema!==1||proof.classification!=='qualified-engine-fatal'||i.engine!=='zwasm-jit'||error.engine!==i.engine||error.workload!==i.workload||error.asOf!==i.source.asOf||error.source!==i.source.ref||done.configuration!==i.engine||done.pinKey!==`${i.engine}|main|${i.source.revision}|${i.source.asOf}`)return false;
  const reasons=[error.error,error.reason,...(error.failures||[]).map(f=>f.reason)].filter(Boolean).flatMap(s=>s.split('; ').filter(Boolean));
  if(!reasons.length||!reasons.every(s=>termination.test(s)))return false;
  const sealed=new Map(proof.sealedFiles.map(f=>[f.path,f.sha256]));
  const verified=f=>{if(!f?.path||!f.sha256||sealed.get(f.path)!==f.sha256)throw Error('Unsealed evidence');const b=readBytes(f.path);if(hash(b)!==f.sha256)throw Error('Changed evidence');return b;};
  for(const f of proof.sealedFiles)verified(f);
  const capture=JSON.parse(verified(proof.originalCapture)),note=JSON.parse(verified(proof.originalFailureNote)),sdk=JSON.parse(verified(proof.sdkReceipt)),diagnostic=JSON.parse(verified(proof.diagnostic.receipt)),manifest=JSON.parse(verified(proof.diagnostic.manifest));
  if(!equal(capture.source,i.source)||!equal(capture.platform,i.platform)||note.engine!==i.engine||note.workload!==i.workload||!equal(note.source,i.source)||!equal(note.phases,error.phases)||note.reason!==error.error)return false;
  if(capture.results.length!==4||new Set(capture.results.map(row=>row.phase)).size!==4||capture.results.some(row=>!['compile','instantiate','first-call','steady'].includes(row.phase))||capture.results.some(row=>row.engine!==i.engine||row.workload!==i.workload||row.version!==i.source.revision||row.artifactSha256!==i.artifactSHA256||row.contractSha256!==i.contractSHA256||row.latencyStatus!=='failed'||row.timingSamples!==0))return false;
  if(sdk.pin.revision!==i.source.revision||sdk.pin.repository!==i.source.repository||sdk.pin.targetWeek!==i.source.asOf||sdk.controllerSha256!==i.controllerSHA256||!equal(sdk.runtime,i.runtime))return false;
  if(hash(readBytes(sdk.controller))!==i.controllerSHA256)return false;
  for(const [path,sha] of Object.entries({...i.runtime.file_sha256,...i.runtime.host_file_sha256}))if(hash(readBytes(path))!==sha)return false;
  if(manifest.host.os!==i.platform.os||manifest.host.arch!==i.platform.arch||manifest.host.cpu_description!==i.platform.cpu||manifest.host.logical_cpus!==i.platform.cores||manifest.host.kernel!==i.platform.kernel)return false;
  const allTrials=proof.sealedFiles.filter(f=>f.path.includes('/capture/trials/')).map(f=>JSON.parse(verified(f)));
  const checks=allTrials.filter(t=>t.id==='check-0-0'),trials=allTrials.filter(t=>t.id!=='check-0-0');
  if(allTrials.length!==5||checks.length!==1||checks[0].runtime_configuration!==i.engine||checks[0].workload!==i.workload||checks[0].status!=='error'||!termination.test(checks[0].reason)||checks[0].log!=='logs/check-0-0.log'||!proof.diagnostic.fatalLog.path.endsWith('/capture/'+checks[0].log))return false;
  if(trials.length!==4||new Set(trials.map(t=>t.scenario)).size!==4||trials.some(t=>t.runtime_configuration!==i.engine||t.workload!==i.workload||t.status!=='preflight_failed'||!termination.test(t.reason)||!['compile','instantiate','first-call','steady'].includes(t.scenario)))return false;
  const runtime=manifest.lock.runtime_configurations.find(r=>r.id===i.engine),workload=manifest.lock.workloads[0];
  if(manifest.lock.workloads.length!==1||manifest.lock.runner_sha256!==i.controllerSHA256||workload.id!==i.workload||workload.sha256!==i.artifactSHA256||workloadContract(workload)!==i.contractSHA256||runtime?.description?.runtime_version!==i.source.revision||runtime?.description?.backend!=='jit'||!equal(runtime.command,i.runtime.command)||!equal(runtime.file_sha256,i.runtime.file_sha256)||!equal(runtime.host_file_sha256,i.runtime.host_file_sha256))return false;
  if(!equal(diagnostic.source,i.source)||diagnostic.workload!==i.workload||diagnostic.sdkReceiptSHA256!==proof.sdkReceipt.sha256||diagnostic.controllerSHA256!==i.controllerSHA256||!equal(diagnostic.runtime,i.runtime)||diagnostic.result.code!==1||diagnostic.result.signal!==null||!Number.isFinite(diagnostic.elapsedMs)||diagnostic.elapsedMs<0||diagnostic.elapsedMs>300000)return false;
  const fatal=verified(proof.diagnostic.fatalLog).toString().trim();
  return fatal==='zwasm: internal error — caught a fatal signal. This is a bug in zwasm (not a wasm trap); please report it.';
 }catch{return false;}
}
export function qualifiedEngineFatalAtRoot(error,done,root){
 if(!root)return false;
 try{return readdirSync(join(root,'engine-failure-classifications')).filter(n=>n.endsWith('.json')).some(name=>qualifiedEngineFatal(error,done,JSON.parse(readFileSync(join(root,'engine-failure-classifications',name),'utf8'))));}catch{return false;}
}
