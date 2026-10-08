import {datasetView} from './api/view.svelte';
import {apiView,aggregateKey,trackId} from './api/controller.svelte';
import {metricSelectors} from './api/presentation';
import { featureContracts, type Scope } from './model';
import { viewCell } from './view-data';
import type { CfgId } from './data/types';
/** Actual contract cell; preserves absence and does not infer normalized work. */
export function featureValue(s:Scope,id:string,c:CfgId,metric='steady') {
  const cell=viewCell(s.machine,s.snapshot || 's1',id,c,metric);
  return cell.st==='ok' && cell.v!=null?cell.v:null;
}
export function familyValue(s:Scope,family:string,c:CfgId,metric='steady') {
  const contracts=featureContracts(family).filter(w=>metric==='compile'||!['compile-only','compile-and-instantiate'].includes(w.evidenceScope || ''));
  if(datasetView.revision){const overview=apiView.aggregates[aggregateKey(s,metric)+'|feature:'+family],card=overview?.cards.find(card=>card.lane===trackId(c));return card?.status==='available'&&card.value!=null&&card.count===contracts.length?card.value/metricSelectors[metric as keyof typeof metricSelectors].factor:null}
  const values=contracts.map(w=>featureValue(s,w.id,c,metric));
  if(!values.length || values.some(v=>v==null || v<=0))return null;
  return Math.exp(values.reduce<number>((sum,v)=>sum+Math.log(v!),0)/values.length);
}
