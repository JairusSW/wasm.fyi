import { featureContracts, type Scope } from './model';
import {datasetView} from './api/view.svelte';
import { viewCell, viewData } from './view-data';
import type { CfgId, Bench, Status } from './data/types';
/** Equal-weight contract average, shared by feature tables, cards and details. */
export function featureAverage(values: readonly (number|null)[], average: Scope['average']='geo'): number|null {
  if(!values.length || values.some(v=>v==null || !Number.isFinite(v) || v<=0))return null;
  const numbers=values as readonly number[];
  return average==='mean'?numbers.reduce((sum,v)=>sum+v,0)/numbers.length:Math.exp(numbers.reduce((sum,v)=>sum+Math.log(v),0)/numbers.length);
}
/** Actual contract cell; preserves absence and does not infer normalized work. */
export function featureValue(s:Scope,id:string,c:CfgId,metric='steady') {
  if(id.startsWith('features/') && featurePerformanceStatus(s,id.split('/')[1],c)!=='ok')return null;
  return measuredValue(s,id,c,metric);
}
function measuredValue(s:Scope,id:string,c:CfgId,metric:string) {
  const cell=viewCell(s.machine,s.snapshot || 's1',id,c,metric);
  return cell.st==='ok' && cell.v!=null?cell.v:null;
}
/** Timings are valid only when the configuration passes the complete feature suite. */
let statusGeneration=-1;
let statusView:typeof datasetView.current|undefined;
const suiteStatusCache=new Map<string,Status>();
export function featurePerformanceStatus(s:Scope,family:string,c:CfgId):Status {
 // Only published immutable views have a generation token. Alternate mutable
 // providers (including fixtures) must be evaluated directly.
 if(!datasetView.current||viewData.featureVersions!==datasetView.current.featureVersions)return uncachedFeaturePerformanceStatus(s,family,c);
 const view=datasetView.current;
 if(statusGeneration!==datasetView.generation||statusView!==view){statusGeneration=datasetView.generation;statusView=view;suiteStatusCache.clear()}
 const key=JSON.stringify([s.machine,s.snapshot,family,c]);
 const known=suiteStatusCache.get(key);if(known)return known;
 const value=uncachedFeaturePerformanceStatus(s,family,c);suiteStatusCache.set(key,value);return value;
}
function uncachedFeaturePerformanceStatus(s:Scope,family:string,c:CfgId):Status {
  // The catalogue can contain contracts from other hosts and older snapshots.
  // Gate against the same selected-version suite shown in Compatibility.
  const suite=viewData.featureVersions?.[s.machine]?.find(v=>v.id===viewData.configurations?.[c])?.features.find(f=>f.id===family);
  if(suite){
    if(suite.failed>0||suite.contracts.some(w=>w.status==='failed'))return 'failed';
    if(suite.contracts.some(w=>w.status==='unsupported'))return 'unsupported';
    return suite.total>0&&suite.pass===suite.total&&suite.contracts.length===suite.total&&suite.contracts.every(w=>w.status==='passed')?'ok':'nm';
  }
  const contracts=featureContracts(family);
  if(!contracts.length)return 'nm';
  const states=contracts.map(w=>{
    const phase=w.evidenceScope==='compile-only'?'compile':w.evidenceScope==='compile-and-instantiate'?'inst':'steady';
    const cell=viewCell(s.machine,s.snapshot||'s1',w.id,c,phase);
    return phase==='steady'&&cell.st==='nm'?viewCell(s.machine,s.snapshot||'s1',w.id,c,'first').st:cell.st;
  });
  return (['crashed','timeout','failed','unsupported','disabled','unavail','nm','na'] as Status[]).find(st=>states.includes(st))||'ok';
}
export function familyValue(s:Scope,family:string,c:CfgId,metric='steady') {
  return familyCohort(s,family,[c],metric).values[0];
}

/** Use the same perf probes in family summaries and expanded corpus rows. */
export function featurePerformanceContracts(contracts:Bench[],metric='steady') {
  const eligible=contracts.filter(w=>metric==='compile'||!['compile-only','compile-and-instantiate'].includes(w.evidenceScope||''));
  const performanceCorpora=new Set(eligible.filter(w=>w.id.split('/')[3]?.startsWith('performance-')).map(w=>w.id.split('/')[2]));
  return eligible.filter(w=>!performanceCorpora.has(w.id.split('/')[2])||w.id.split('/')[3]?.startsWith('performance-'));
}

/** Feature comparisons include only contracts passed by every selected engine. */
export function contractCohort(s:Scope,contracts:Bench[],cids:CfgId[],metric='steady') {
  // Compute suite eligibility once per family/configuration, not for every metric cell.
  const families=[...new Set(contracts.map(w=>w.id.split('/')[1]))];
  const eligibility=new Map(cids.map(c=>[c,new Map(families.map(f=>[f,featurePerformanceStatus(s,f,c)]))]));
  const ok=(id:string,c:CfgId)=>{const v=measuredValue(s,id,c,metric);return eligibility.get(c)?.get(id.split('/')[1])==='ok'&&v!=null&&Number.isFinite(v)&&v>0;};
  const passed=cids.map(c=>contracts.filter(w=>ok(w.id,c)).length);
  const cohort=s.cohortMode==='per-engine'?contracts:contracts.filter(w=>cids.length>0&&cids.every(c=>ok(w.id,c)));
  const cohorts=cids.map(c=>cohort.filter(w=>ok(w.id,c)));
  const values=cohorts.map((rows,k)=>s.cohortMode!=='per-engine'&&rows.length!==cohort.length?null:featureAverage(rows.map(w=>measuredValue(s,w.id,cids[k],metric)),s.average));
  const statuses=cids.map((c,k):Status=>{
    if(values[k]!=null)return 'ok';
    const invalid=families.map(f=>eligibility.get(c)?.get(f)).find(st=>st&&st!=='ok');
    if(invalid)return invalid;
    if(passed[k]>0)return 'unavail';
    const states=contracts.map(w=>viewCell(s.machine,s.snapshot||'s1',w.id,c,metric).st);
    return (['crashed','timeout','failed','unsupported','disabled','unavail','nm','na'] as Status[]).find(st=>states.includes(st))||'nm';
  });
  return {contracts,cohort,cohorts,values,passed,statuses,suitePassed:cids.map(c=>families.length>0&&families.every(f=>eligibility.get(c)?.get(f)==='ok')),valid:values.map(v=>v!=null)};
}
let familyGeneration=-1;
let familyView:typeof datasetView.current|undefined;
const familyCache=new Map<string,ReturnType<typeof contractCohort>>();
export function familyCohort(s:Scope,family:string,cids:CfgId[],metric='steady') {
 if(!datasetView.current||viewData.featureVersions!==datasetView.current.featureVersions)return contractCohort(s,featurePerformanceContracts(featureContracts(family),metric),cids,metric);
 const view=datasetView.current;
 if(familyGeneration!==datasetView.generation||familyView!==view){familyGeneration=datasetView.generation;familyView=view;familyCache.clear()}
 const key=JSON.stringify([s.machine,s.snapshot,family,cids,metric,s.cohortMode,s.average]);
 const known=familyCache.get(key);if(known)return known;
 const result=contractCohort(s,featurePerformanceContracts(featureContracts(family),metric),cids,metric);
 if(familyCache.size>=256)familyCache.clear();familyCache.set(key,result);return result;
}
