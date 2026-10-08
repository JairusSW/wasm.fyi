import { aggregate, aggregateCohort, measuredCohort, cohortWeights, weightedGeometricMean } from './aggregates';
import { fmtU } from './format';
import { viewData, type ViewCell } from './view-data';
import type { CfgId, MachineId, MetricKey, OtMetricKey } from './data/types';
import type { Scope, PerfGroup } from './model';

export const historyCatalogue=(machine:MachineId)=>viewData.history[machine].catalogue ?? viewData.catalogue;
export const historyCell=(machine:MachineId,workload:string,cid:CfgId,metric:MetricKey,i:number):ViewCell=>viewData.history[machine].cells[`${workload}|${cid}|${metric}`]?.[i] || {st:'nm',report:''};
/** Release labels receive markers; source revisions and unmeasured points do not. */
export function historyVersionChanges(versions:string[],values:number[]):number[] {
 let previous='';const changes:number[]=[];
 for(const [i,value] of values.entries()){
  const version=versions[i];
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
const metricOf:Record<OtMetricKey,MetricKey>={exec:'steady',wasmHost:'steady',hostWasm:'steady',roundTrip:'steady',compile:'compile',inst:'inst',mem:'rss',code:'code',cov:'steady'};
const aggregateOf:Partial<Record<OtMetricKey,[PerfGroup,number]>>={exec:['lat',3],compile:['lat',0],inst:['lat',1],mem:['mem',2],code:['code',3]};
export const historicalCallWorkloads=(key:OtMetricKey):string[]=>key==='wasmHost'?['mechanisms/wasm-to-host-call']:key==='hostWasm'?['mechanisms/host-to-wasm-call']:key==='roundTrip'?['mechanisms/wasm-to-host-call','mechanisms/host-to-wasm-call']:[];
const valid=(c:ViewCell)=>c.st==='ok' && c.v!=null && Number.isFinite(c.v) && c.v>0;
export function historyReusesEvidence(machine:MachineId,cid:CfgId,key:OtMetricKey,before:number,after:number) {
  if(before<0 || before===after)return false;
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
	const catalogue=new Map(historyCatalogue(s.machine).map(w=>[w.id,w]));
	const values=h.points.map((point,i)=>{
		const current=point.currentLatency?.[cid];
		const column=aggregateOf[key];
		if(current && column?.[0]==='lat' && !h.referenceCells)return aggregate({...s,snapshot:current},column[0],cid,column[1])?.v ?? Number.NaN;
		const cohort=historyCohort(s,cid,key,i);
		if(point.status!=='measured'||!cohort.length)return Number.NaN;
		return weightedGeometricMean(cohort.map(w=>historyCell(s.machine,w,cid,metric,i).v!),cohortWeights(cohort.map(w=>catalogue.get(w)!),s.weighting));
	});
	return values.some(Number.isFinite)?values:null;
}


/** The canonical recorded reference is independent of new prepared source builds. */
export function historyReferenceCohort(s:Scope,cid:CfgId,key:OtMetricKey) {
 const h=viewData.history[s.machine],column=aggregateOf[key];
 if(!column)return [];
 if(!h.referenceCells)return aggregateCohort({...s,snapshot:'s1'},column[0],cid,column[1]).cohort;
 const workloads=historyCatalogue(s.machine).filter(w=>column[0]!=='lat'||!w.id.startsWith('features/'));
 const requested=[...new Set([...viewData.applicationConfigurations.filter(c=>!s.hide[c]),s.baseline])];
 return measuredCohort(workloads,requested,cid,(w,c)=>h.referenceCells![`${w}|${c}|${metricOf[key]}`] || {st:'nm',report:''}).cohort;
}

/** Use the recorded comparison cohort as a stable reference; retain each capture's gaps. */
export function historyCohort(s:Scope,cid:CfgId,key:OtMetricKey,i:number):string[] {
 const h=viewData.history[s.machine],metric=metricOf[key];
 const current=h.points[i]?.currentLatency?.[cid];
 const column=aggregateOf[key];
 if(current && column?.[0]==='lat' && !h.referenceCells)return aggregateCohort({...s,snapshot:current},column[0],cid,column[1]).cohort.map(w=>w.id);
 if(column){
  const reference=historyReferenceCohort(s,cid,key);
  if(reference.length)return reference.filter(w=>{const c=historyCell(s.machine,w.id,cid,metric,i);return !!c.report&&valid(c);}).map(w=>w.id);
 }
 // Without a shared canonical reference, retain dated shared evidence rather than invent a denominator.
 const recorded=new Set(h.workloads);
 const workloads=historyCatalogue(s.machine).filter(w=>recorded.has(w.id)&&(!['exec','compile','inst'].includes(key)||!w.id.startsWith('features/')));
 const requested=[...new Set([...viewData.applicationConfigurations.filter(c=>!s.hide[c]),s.baseline])];
 return measuredCohort(workloads,requested,cid,(w,c)=>historyCell(s.machine,w,c,metric,i)).cohort.map(w=>w.id);
}
export function historyAggregateDetails(s:Scope,cid:CfgId,key:OtMetricKey,i:number):string {
 const column=aggregateOf[key];if(!column)return '';
 const capture=viewData.history[s.machine].points[i]?.currentLatency?.[cid]?'Canonical recorded release capture.':'Archived capture.';
 const count=historyCohort(s,cid,key,i).length;
 const reference=historyReferenceCohort(s,cid,key).length;
 const label=column[0]==='lat'?'non-feature workloads':'workloads';
 const coverage=reference?`${count} of ${reference} reference ${label}${count<reference?'; partial coverage':''}`:`${count} successful ${label}`;
 const basis=reference?'Reference cohort uses recorded artifact identities.':'No shared canonical reference is available; completeness is unknown.';
 return `Geometric mean of ${coverage}; ${s.weighting} weighting. ${basis} ${capture}`;
}

export function historyCoverage(s:Scope,cid:CfgId,key:OtMetricKey,i:number) {
 const column=aggregateOf[key];
 if(!column)return {complete:true,measured:0,reference:0};
 const reference=historyReferenceCohort(s,cid,key).length;
 const measured=historyCohort(s,cid,key,i).length;
 return {complete:!reference||measured===reference,measured,reference};
}

/** Compare recorded values on exactly the same workloads at both dates. */
export function historyComparison(s:Scope,cid:CfgId,key:OtMetricKey,before:number,after:number) {
 if(before<0||after<0)return null;
 if(!aggregateOf[key]){
  const values=historySeries(s,cid,key),a=values?.[before],b=values?.[after];
  return a!=null&&b!=null&&Number.isFinite(a)&&Number.isFinite(b)?{before:a,after:b,ratio:b/a,count:0}:null;
 }
 const next=new Set(historyCohort(s,cid,key,after));
 const workloads=historyCohort(s,cid,key,before).filter(w=>next.has(w));
 const metric=metricOf[key];
 const matched=workloads.filter(w=>valid(historyCell(s.machine,w,cid,metric,before))&&valid(historyCell(s.machine,w,cid,metric,after)));
 if(!matched.length)return null;
 const catalogue=new Map(historyCatalogue(s.machine).map(w=>[w.id,w]));
 const weights=cohortWeights(matched.map(w=>catalogue.get(w)!),s.weighting);
 const mean=(i:number)=>weightedGeometricMean(matched.map(w=>historyCell(s.machine,w,cid,metric,i).v!),weights);
 const a=mean(before),b=mean(after);return {before:a,after:b,ratio:b/a,count:matched.length};
}


export function historyCallDetails(scope:Scope, cid:CfgId, point:number) {
	const wasmHost=historySeries(scope,cid,'wasmHost')?.[point];
	const hostWasm=historySeries(scope,cid,'hostWasm')?.[point];
	const format=(value:number|undefined)=>value!=null && Number.isFinite(value)?fmtU(value,'ms'):'not measured';
	return `Wasm → host: ${format(wasmHost)} · Host → Wasm: ${format(hostWasm)} · Estimated round trip sums both medians; not a measured nested round trip.`;
}
