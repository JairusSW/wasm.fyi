import {mkdir,copyFile,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {CALL_LOOP_WORKLOAD,CALL_LOOP_ITERATIONS,CALL_MIN_BATCH_NS} from './call-policy.mjs';
export {CALL_LOOP_WORKLOAD,CALL_LOOP_ITERATIONS,CALL_MIN_BATCH_NS} from './call-policy.mjs';
// Dedicated boundary-call batches measure per-call cost with enough operations
// to amortize the timer. Keep failures within that measurement class visible.
export function callTimingCandidates(candidates, workload, metric) {
  if(metric==='steady' && workload===CALL_LOOP_WORKLOAD){const batches=candidates.filter(r=>r.options.scenarios?.length===1 && r.options.scenarios[0]==='steady');return batches.length?batches:candidates;}
  if (metric !== 'steady' || !/^mechanisms\/(host-to-wasm-call|wasm-to-host-call)$/.test(workload)) return candidates;
  const batches = candidates.filter(report => report.options.operations >= 1000000);
  return batches.length ? batches : candidates;
}

export function callBatchOperations(workload) {return workload.id===CALL_LOOP_WORKLOAD?1:1000000;}
export function minimumCallBatch(trials) {
 const samples=trials.filter(t=>t.block>=0 && t.status==='ok' && t.profile==='timing' && t.scenario==='steady').flatMap(t=>t.samples || []).filter(s=>s.verified && s.operations>0);
 return samples.length?Math.min(...samples.map(s=>s.elapsed_ns)):null;
}
export async function collectCallBatches({run,verify,load,directory,prefix,samples=3,operations=1000000,evidenceDirectory,onAttempt=()=>{}}) {
 for(let attempt=0;attempt<8;attempt++){
  const timing=directory+'/'+prefix+'-call-timing-'+attempt;
  await run(timing,operations,samples);await verify(timing);
  const minimum=minimumCallBatch(await load(timing));
  if(evidenceDirectory){
   const target=join(evidenceDirectory,prefix+'-attempt-'+attempt);await mkdir(target,{recursive:true});
   for(const name of ['manifest.json','checksums.json'])await copyFile(join(timing,name),join(target,name));
   for(const name of ['trials','logs'])await cp(join(timing,name),join(target,name),{recursive:true}).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  await onAttempt({attempt,timing,operations,minimumElapsedNS:minimum,minimumRequiredNS:CALL_MIN_BATCH_NS});
  if(minimum==null || minimum>=CALL_MIN_BATCH_NS)return timing;
  const next=Math.min(1000000,Math.max(operations+1,Math.ceil(operations*(minimum>0?CALL_MIN_BATCH_NS/minimum*1.5:10))));
  if(next===operations)throw Error('Call batches did not reach 0.5 ms within the operation limit');
  operations=next;
 }
 throw Error('Call batch duration calibration did not converge');
}
