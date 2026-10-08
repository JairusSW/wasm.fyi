import {FEATURE_PERFORMANCE_BATCH_NS} from './feature-performance.mjs';
export function minimumFeatureBatch(trials) {
 const samples=trials.filter(t=>t.block>=0&&t.status==='ok'&&t.profile==='timing'&&t.scenario==='steady').flatMap(t=>t.samples||[]).filter(s=>!s.warmup&&s.verified&&s.operations>0);
 return samples.length?Math.min(...samples.map(s=>s.elapsed_ns)):null;
}
/** Calibration outputs are discarded; only the duration-qualified run is retained. */
export async function collectFeatureBatches({run,load,directory,prefix='features',samples=5,operations=1,minimumNs=FEATURE_PERFORMANCE_BATCH_NS}) {
 for(let attempt=0;attempt<6;attempt++){
  const output=directory+'/'+prefix+'-steady-'+attempt;
  await run(output,operations,samples);
  const trials=await load(output),minimum=minimumFeatureBatch(trials);
  if(minimum==null||minimum>=minimumNs)return output;
  const eligible=trials.filter(t=>t.block>=0&&t.status==='ok'&&t.profile==='timing'&&t.scenario==='steady').flatMap(t=>t.samples||[]).filter(s=>!s.warmup&&s.verified);
  if(eligible.some(s=>s.operations<operations))throw Error('Fresh-instance feature did not reach the minimum duration; increase its source workload size');
  const next=Math.min(1000000,Math.max(operations+1,Math.ceil(operations*(minimum>0?minimumNs/minimum*1.25:10))));
  if(next===operations)throw Error('Feature did not reach the minimum duration within the operation limit');
  operations=next;
 }
 throw Error('Feature duration calibration did not converge');
}
