import {CALL_PATHS,CALL_LOOP_WORKLOAD} from './call-paths';
import {apiHistory,historyKey,timelineLane} from './api/history.svelte';
import {datasetView} from './api/view.svelte';
import { aggregate, aggregateCohort, measuredCohort, cohortWeights, weightedGeometricMean } from './aggregates';
import { fmtU } from './format';
import { viewData, type ViewCell } from './view-data';
import type { CfgId, MachineId, MetricKey, OtMetricKey } from './data/types';
import type { Scope, PerfGroup } from './model';

export const historyCell=(machine:MachineId,workload:string,cid:CfgId,metric:MetricKey,i:number):ViewCell=>viewData.history[machine].cells[`${workload}|${cid}|${metric}`]?.[i] || {st:'nm',report:''};
/** Release labels receive markers; source revisions and unmeasured points do not. */
export function historyVersionChanges(versions:string[],values:number[],releasePoints?:ReadonlySet<number>):number[] {
 let previous='';const changes:number[]=[];
 for(const [i,value] of values.entries()){
  const version=versions[i];
  if(datasetView.revision&&!releasePoints?.has(i))continue;
  if(!Number.isFinite(value)||!version||version==='not collected'||/^[a-f0-9]{7,40}(?:$|\/)/i.test(version))continue;
  if(version!==previous)changes.push(i);
  previous=version;
 }
 return changes;
}
export function historyChange(before:ViewCell,after:ViewCell) {
	if(!valid(before)||!valid(after))return null;
	const delta=after.v!/before.v!-1;
	if(before.report===after.report)return {delta,interval:[0,0] as [number,number],fixed:true};
	const a=before.launchMedians || [],b=after.launchMedians || [];
	if(a.length<2 || b.length<2)return {delta,fixed:false};
	const median=(v:number[])=>{v.sort((a,b)=>a-b);return v.length%2?v[v.length>>1]:(v[(v.length>>1)-1]+v[v.length>>1])/2;};
	let state=2166136261;for(const c of before.report+after.report){state^=c.charCodeAt(0);state=Math.imul(state,16777619);}state=state>>>0 || 1;
	const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
	const samples=Array.from({length:1024},()=>median(Array.from({length:b.length},()=>b[Math.floor(random()*b.length)]))/median(Array.from({length:a.length},()=>a[Math.floor(random()*a.length)]))-1).sort((a,b)=>a-b);
	return {delta,interval:[samples[25],samples[998]] as [number,number],fixed:false};
}
const metricOf:Record<OtMetricKey,MetricKey>={exec:'steady',callTotal:'steady',hostWasm:'steady',wasmHostLoop:'steady',compile:'compile',inst:'inst',mem:'rss',code:'code',cov:'steady'};
const aggregateOf:Partial<Record<OtMetricKey,[PerfGroup,number]>>={exec:['lat',3],compile:['lat',0],inst:['lat',1],mem:['mem',2],code:['code',3]};
export const historicalCallWorkloads=(key:OtMetricKey):string[]=>key==='callTotal'?CALL_PATHS.map(p=>p.id):key==='hostWasm'?['mechanisms/host-to-wasm-call']:key==='wasmHostLoop'?[CALL_LOOP_WORKLOAD]:[];
const valid=(c:ViewCell)=>c.st==='ok' && c.v!=null && Number.isFinite(c.v) && c.v>0;
export function historyReusesEvidence(machine:MachineId,cid:CfgId,key:OtMetricKey,before:number,after:number) {
  if(before<0 || before===after)return false;
  if(datasetView.revision){const timeline=apiHistory.series[apiHistory.active[machine+'|'+key]];const a=timeline?.items[before]?.lanes.find(l=>l.track===apiHistory.slots[cid]),b=timeline?.items[after]?.lanes.find(l=>l.track===apiHistory.slots[cid]);return !!a?.evidence&&a.evidence===b?.evidence}
  const calls=historicalCallWorkloads(key),workloads=calls.length?calls:viewData.history[machine].workloads;
  const pairs=workloads.map(w=>[historyCell(machine,w,cid,metricOf[key],before),historyCell(machine,w,cid,metricOf[key],after)]);
  const recorded=pairs.filter(([a,b])=>a.report || b.report);
  return recorded.length>0 && recorded.every(([a,b])=>a.report && a.report===b.report && a.st===b.st);
}
export function historySegments(values:number[],x:(i:number)=>number,y:(v:number)=>number,connectGaps=false):string[] {
	const segments:string[]=[];let points:string[]=[];
	for(const [i,v] of values.entries()){
		if(!Number.isFinite(v)){if(connectGaps)continue;if(points.length)segments.push(points.join(' '));points=[];continue;}
		points.push(x(i).toFixed(1)+','+y(v).toFixed(1));
	}
	if(points.length)segments.push(points.join(' '));return segments;
}

/** Horizontal tangents keep each curve within its two measured endpoint values. */
export function historyCurve(points:string):string {
 const coordinates=points.trim().split(/\s+/).filter(Boolean).map(p=>p.split(',').map(Number));
 if(!coordinates.length)return '';
 let path=`M ${coordinates[0].join(',')}`;
 for(let i=1;i<coordinates.length;i++){
  const [px,py]=coordinates[i-1],[x,y]=coordinates[i],mid=(px+x)/2;
  path+=` C ${mid},${py} ${mid},${y} ${x},${y}`;
 }
 return path;
}

/** A measured cohort for each date; missing points stay gaps. */
export function historySeries(s:Scope,cid:CfgId,key:OtMetricKey,workload=''):number[]|null {
 if(datasetView.revision){const timeline=apiHistory.series[historyKey(s,key,workload)];if(!timeline)return null;const factor=key==='mem'?1024**2:key==='code'?1024:key==='cov'?1:1e6;const values=timeline.items.map(p=>{const lane=p.lanes.find(l=>l.track===apiHistory.slots[cid]);return lane?.value==null?Number.NaN:lane.value/factor});return values.some(Number.isFinite)?values:null}
	const h=viewData.history[s.machine];const metric=metricOf[key];
	const series=(w:string,c:CfgId)=>h.points.map((_,i)=>historyCell(s.machine,w,c,metric,i));
	const calls=historicalCallWorkloads(key);
	if(calls.length){
		if(workload && !calls.includes(workload))return null;
		const ids=workload?[workload]:calls;
		const values=h.points.map((point,i)=>{const cells=ids.map(w=>historyCell(s.machine,w,cid,'steady',i));return point.status==='measured'&&cells.every(valid)?cells.reduce((sum,c)=>sum+c.v!,0):Number.NaN;});
		return values.some(Number.isFinite)?values:null;
	}
	if(workload){const cells=series(workload,cid);return cells.some(valid)?cells.map(c=>valid(c)?c.v!:Number.NaN):null;}
	if(key==='cov') {
		if(!h.workloads.some(w=>series(w,cid).some(c=>c.report)))return null;
		return h.points.map((_,i)=>h.workloads.some(w=>historyCell(s.machine,w,cid,'steady',i).report)?h.workloads.filter(w=>historyCell(s.machine,w,cid,'steady',i).st==='ok').length:Number.NaN);
	}
	const catalogue=new Map(viewData.catalogue.map(w=>[w.id,w]));
	const values=h.points.map((point,i)=>{
		const current=point.currentLatency?.[cid];
		const column=aggregateOf[key];
		if(current && column?.[0]==='lat')return aggregate({...s,snapshot:current},column[0],cid,column[1])?.v ?? Number.NaN;
		const cohort=historyCohort(s,cid,key,i);
		if(point.status!=='measured'||!cohort.length)return Number.NaN;
		return weightedGeometricMean(cohort.map(w=>historyCell(s.machine,w,cid,metric,i).v!),cohortWeights(cohort.map(w=>catalogue.get(w)!),s.weighting));
	});
	return values.some(Number.isFinite)?values:null;
}


/** Use the current comparison cohort as a stable reference; retain each capture's gaps. */
export function historyCohort(s:Scope,cid:CfgId,key:OtMetricKey,i:number):string[] {
 const h=viewData.history[s.machine],metric=metricOf[key];
 const current=h.points[i]?.currentLatency?.[cid];
 const column=aggregateOf[key];
 if(current && column?.[0]==='lat')return aggregateCohort({...s,snapshot:current},column[0],cid,column[1]).cohort.map(w=>w.id);
 if(column){
  const reference=aggregateCohort({...s,snapshot:'s1'},column[0],cid,column[1]).cohort;
  if(reference.length)return reference.filter(w=>{const c=historyCell(s.machine,w.id,cid,metric,i);return !!c.report&&valid(c);}).map(w=>w.id);
 }
 const recorded=new Set(h.workloads);
 const workloads=viewData.catalogue.filter(w=>recorded.has(w.id)&&(!['exec','compile','inst'].includes(key)||!w.id.startsWith('features/')));
 // Source dates differ across engines; an archived lane uses its own recorded corpus.
 const requested=[cid];
 return measuredCohort(workloads,requested,cid,(w,c)=>historyCell(s.machine,w,c,metric,i)).cohort.map(w=>w.id);
}
export function historyAggregateDetails(s:Scope,cid:CfgId,key:OtMetricKey,i:number):string {
 const column=aggregateOf[key];if(!column)return '';
 const capture=viewData.history[s.machine].points[i]?.currentLatency?.[cid]?'Same canonical release capture and workload cohort as the current chart.':'Archived capture.';
 const count=historyCohort(s,cid,key,i).length;
 const reference=aggregateCohort({...s,snapshot:'s1'},column[0],cid,column[1]).cohort.length;
 const coverage=reference?`${count} of ${reference} reference non-feature workloads${count<reference?'; partial coverage':''}`:`${count} successful non-feature workloads`;
 return `Geometric mean of ${coverage}; ${s.weighting} weighting. Reference cohort matches the current chart. ${capture}`;
}

export function historyCoverage(s:Scope,cid:CfgId,key:OtMetricKey,i:number) {
 if(datasetView.revision){const lane=timelineLane(s,cid,key,i);return {complete:!!lane&&lane.measured===lane.reference,measured:lane?.measured||0,reference:lane?.reference||0}}
 const column=aggregateOf[key];
 if(!column)return {complete:true,measured:0,reference:0};
 const reference=aggregateCohort({...s,snapshot:'s1'},column[0],cid,column[1]).cohort.length;
 const measured=historyCohort(s,cid,key,i).length;
 return {complete:!reference||measured===reference,measured,reference};
}

/** Compare recorded values on exactly the same workloads at both dates. */
export function historyComparison(s:Scope,cid:CfgId,key:OtMetricKey,before:number,after:number) {
 if(before<0||after<0)return null;
 if(datasetView.revision){const timeline=apiHistory.series[historyKey(s,key)];const a=timeline?.items[before]?.date,b=timeline?.items[after]?.date;return a&&b?apiHistory.changes[JSON.stringify([historyKey(s,key),cid,a,b])]||null:null}
 if(!aggregateOf[key]){
  const values=historySeries(s,cid,key),a=values?.[before],b=values?.[after];
  return a!=null&&b!=null&&Number.isFinite(a)&&Number.isFinite(b)?{before:a,after:b,ratio:b/a,count:0}:null;
 }
 const next=new Set(historyCohort(s,cid,key,after));
 const workloads=historyCohort(s,cid,key,before).filter(w=>next.has(w));
 const metric=metricOf[key];
 const matched=workloads.filter(w=>valid(historyCell(s.machine,w,cid,metric,before))&&valid(historyCell(s.machine,w,cid,metric,after)));
 if(!matched.length)return null;
 const catalogue=new Map(viewData.catalogue.map(w=>[w.id,w]));
 const weights=cohortWeights(matched.map(w=>catalogue.get(w)!),s.weighting);
 const mean=(i:number)=>weightedGeometricMean(matched.map(w=>historyCell(s.machine,w,cid,metric,i).v!),weights);
 const a=mean(before),b=mean(after);return {before:a,after:b,ratio:b/a,count:matched.length};
}


export function historyCallDetails(scope:Scope, cid:CfgId, point:number) {
	const wasmHost=historySeries(scope,cid,'wasmHostLoop')?.[point];
	const hostWasm=historySeries(scope,cid,'hostWasm')?.[point];
	const format=(value:number|undefined)=>value!=null && Number.isFinite(value)?fmtU(value,'ms'):'not measured';
	return `${CALL_PATHS[0].label}: ${format(wasmHost)} · ${CALL_PATHS[1].label}: ${format(hostWasm)} · ${CALL_PATHS[0].note}`;
}

/** Structured counterpart of the detail strings, for visual tooltips. */
export function historyPointInfo(s:Scope,cid:CfgId,key:OtMetricKey,i:number) {
	const call=(k:OtMetricKey)=>{const v=historySeries(s,cid,k)?.[i];return v!=null&&Number.isFinite(v)?v:null;};
	return {
		coverage:historyCoverage(s,cid,key,i),
		archived:!!aggregateOf[key] && !viewData.history[s.machine].points[i]?.currentLatency?.[cid],
		calls:historicalCallWorkloads(key).length?{label:key==='callTotal'?'Total call latency':CALL_PATHS.find(p=>p.key===key)!.label,value:call(key),note:key==='callTotal'?'Sum of both measured call directions.':CALL_PATHS.find(p=>p.key===key)!.note}:null
	};
}

export type HistoryVerdict='improved'|'regressed'|'no practical change'|'inconclusive'|'reused evidence';
/**
 * Classifies a per-workload change against the ±threshold. With a bootstrap
 * interval the whole interval must clear it. Historical captures usually hold
 * a single launch, so without an interval the point estimate decides and the
 * result is flagged `estimate` rather than reported as uniformly inconclusive.
 */
export function historyVerdict(change:NonNullable<ReturnType<typeof historyChange>>,threshold=.02):{verdict:HistoryVerdict;estimate:boolean} {
 if(change.fixed)return {verdict:'reused evidence',estimate:false};
 const interval=change.interval;
 if(!interval){
  const d=change.delta;
  return {verdict:d>threshold?'regressed':d<-threshold?'improved':'no practical change',estimate:true};
 }
 const verdict:HistoryVerdict=interval[0]>threshold?'regressed':interval[1]<-threshold?'improved':interval[0]>=-threshold&&interval[1]<=threshold?'no practical change':'inconclusive';
 return {verdict,estimate:false};
}

/** First and last measured points of `values` inside [from, to], or null when fewer than two exist. */
export function historyEndpoints(values:number[]|null|undefined,from:number,to:number):[number,number]|null {
 if(!values)return null;
 let a=-1,b=-1;
 for(let i=from;i<=to;i++)if(Number.isFinite(values[i])){if(a<0)a=i;b=i;}
 return a>=0&&b>a?[a,b]:null;
}
