import {leastCoveredReference} from './comparison-policy';
import { featureContracts, type Scope } from './model';
import { viewCell } from './view-data';
import type { CfgId, Bench, Status } from './data/types';
/** Equal-weight contract average, shared by feature tables, cards and details. */
export function featureAverage(values: readonly (number|null)[], average: Scope['average']='geo'): number|null {
  if(!values.length || values.some(v=>v==null || !Number.isFinite(v) || v<=0))return null;
  const numbers=values as readonly number[];
  return average==='mean'?numbers.reduce((sum,v)=>sum+v,0)/numbers.length:Math.exp(numbers.reduce((sum,v)=>sum+Math.log(v),0)/numbers.length);
}
/** Actual contract cell; preserves absence and does not infer normalized work. */
export function featureValue(s:Scope,id:string,c:CfgId,metric='steady') {
  const cell=viewCell(s.machine,s.snapshot || 's1',id,c,metric);
  return cell.st==='ok' && cell.v!=null?cell.v:null;
}
export function familyValue(s:Scope,family:string,c:CfgId,metric='steady') {
  return familyCohort(s,family,[c],metric).values[0];
}

/** Same passing-workload selection as the benchmark table, before averaging. */
export function contractCohort(s:Scope,contracts:Bench[],cids:CfgId[],metric='steady') {
  const ok=(id:string,c:CfgId)=>{const v=featureValue(s,id,c,metric);return v!=null&&Number.isFinite(v)&&v>0;};
  const passed=cids.map(c=>contracts.filter(w=>ok(w.id,c)).length);
  const cohort=s.cohortMode==='per-engine'?contracts:leastCoveredReference(contracts,cids,(w,c)=>ok(w.id,c));
  const cohorts=cids.map(c=>cohort.filter(w=>ok(w.id,c)));
  const values=cohorts.map((rows,k)=>s.cohortMode!=='per-engine'&&rows.length!==cohort.length?null:featureAverage(rows.map(w=>featureValue(s,w.id,cids[k],metric)),s.average));
  const statuses=cids.map((c,k):Status=>{
    if(values[k]!=null)return 'ok';
    if(passed[k]>0)return 'unavail';
    const states=contracts.map(w=>viewCell(s.machine,s.snapshot||'s1',w.id,c,metric).st);
    return (['crashed','timeout','failed','unsupported','disabled','unavail','nm','na'] as Status[]).find(st=>states.includes(st))||'nm';
  });
  return {contracts,cohort,cohorts,values,passed,statuses,valid:values.map(v=>v!=null)};
}
export function familyCohort(s:Scope,family:string,cids:CfgId[],metric='steady') {
  const contracts=featureContracts(family).filter(w=>metric==='compile'||!['compile-only','compile-and-instantiate'].includes(w.evidenceScope || ''));
  return contractCohort(s,contracts,cids,metric);
}
