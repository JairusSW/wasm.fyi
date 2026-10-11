import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {withBuildLock} from './lib/measurement-lock.mjs';import {atomicJSON} from './lib/benchmark-plan.mjs';import {classifyFeatureCompilerRejection,classifyFeatureCapture} from './lib/feature-unsupported.mjs';
const [campaign,root]=process.argv.slice(2);if(!root)throw Error('Usage: normalize-feature-unsupported CAMPAIGN FEATURE_ROOT');
const read=async p=>JSON.parse(await readFile(p)),sha=b=>createHash('sha256').update(b).digest('hex');
await withBuildLock(campaign,async()=>{
 const ledger=await read(join(root,'ledger.json'));await mkdir(join(root,'raw-captures'),{recursive:true});const changed=[];
 for(const [key,item] of Object.entries(ledger.items)){
  if(item.engine!=='wasmer-cranelift'||item.stage!=='compatibility'||!item.workload.startsWith('features/tail-call/')||!item.failure)continue;
  const producer=join(root,'compatibility',item.engine,key,'producer'),manifestBytes=await readFile(join(producer,'manifest.json')),manifest=JSON.parse(manifestBytes),workload=manifest.lock.workloads.find(w=>w.id===item.workload),trialFiles=(await readdir(join(producer,'trials'))).filter(f=>f.endsWith('.json'));
  const rawTrials=await Promise.all(trialFiles.map(async file=>({file,bytes:await readFile(join(producer,'trials',file))}))),trials=rawTrials.map(t=>JSON.parse(t.bytes));
  const evidence=classifyFeatureCompilerRejection({source:item.source,engine:item.engine,workload,manifest,trials});if(!evidence)continue;
  const before=await readFile(join(root,'captures',item.capture));if(!before.equals(Buffer.from(before.toString('utf8'),'utf8')))throw Error('Malformed capture UTF8');const capture=JSON.parse(before);if(capture.source.revision!==item.source.revision||capture.source.asOf!==item.source.asOf)throw Error('Capture source changed');
  const after=classifyFeatureCapture(capture,evidence);if(!after)continue;
  await writeFile(join(root,'raw-captures',item.capture+'.before-source-unsupported'),before,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e});
  // Failed zero-sample rows: change only status literals; no numeric/token rewrites.
  const bytes=Buffer.from(before.toString('utf8').replace(/("latencyStatus"\s*:\s*)"failed"/g,'$1"unsupported"'));if(JSON.stringify(JSON.parse(bytes))!==JSON.stringify(after))throw Error('Unsupported normalization changes unrelated fields');
  const receipt={...evidence,originalSha256:sha(before),derivedSha256:sha(bytes),manifestSha256:sha(manifestBytes),trials:rawTrials.map(t=>({path:join(producer,'trials',t.file),sha256:sha(t.bytes)})),capture:item.capture};
  await atomicJSON(join(root,'source-dispositions',key+'.json'),receipt);
  const note={...item.failure,kind:'source-proven-unsupported',reason:evidence.reason,unsupportedEvidence:receipt};await atomicJSON(join(root,'failure-notes',item.capture),note);await atomicJSON(join(campaign,'failure-notes',item.capture),note);
  for(const path of [join(root,'captures',item.capture),join(campaign,'captures',item.capture)]){await writeFile(path+'.source-unsupported.tmp',bytes);await (await import('node:fs/promises')).rename(path+'.source-unsupported.tmp',path)}
  item.outcomes=item.outcomes.map(([phase])=>[phase,'unsupported']);item.failure=note;changed.push(receipt);
 }
 await atomicJSON(join(root,'ledger.json'),ledger);await atomicJSON(join(root,'source-unsupported-normalized.json'),{status:'passed',changed,at:new Date().toISOString()});
});
