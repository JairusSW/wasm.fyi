import {isDeepStrictEqual} from 'node:util';
import {reusableCapture} from './history-scope.mjs';
const phases=['compile','instantiate','first-call','steady'];
export function selectRepairPhases(existing,workload,job){
 if(job.repairPhases===undefined)return null;
 const requested=job.repairPhases;
 if(!Array.isArray(requested)||!requested.length||new Set(requested).size!==requested.length||requested.some(p=>!phases.includes(p))||!job.repairReason?.trim())throw Error('Phase repair requires explicit distinct phases and a reason');
 if(!reusableCapture(existing,workload,job.source,0,false))throw Error('Phase repair requires an existing capture with the exact source and workload contract');
 return requested.filter(phase=>existing.results.find(r=>r.phase===phase).latencyStatus!=='ok');
}
export function mergePhaseRepair(existing,replacement,selected){
 if(!isDeepStrictEqual(existing.source,replacement.source))throw Error('Phase repair source changed');
 if(!isDeepStrictEqual(existing.platform,replacement.platform))throw Error('Phase repair platform changed');
 const replacements=new Map(replacement.results.map(r=>[r.phase,r]));
 if(replacements.size!==selected.length||replacement.results.length!==selected.length||selected.some(p=>!replacements.has(p)))throw Error('Phase repair returned unexpected phases');
 const results=existing.results.map(before=>{
  if(!replacements.has(before.phase))return before;
  if(before.latencyStatus==='ok')throw Error('Refusing to replace an already measured phase');
  const after=replacements.get(before.phase);
  for(const key of ['engine','version','workload','artifactSha256','contractSha256'])if(before[key]!==after[key])throw Error('Phase repair identity changed: '+key);
  return after;
 });
 return {...existing,capturedAt:replacement.capturedAt,results};
}
