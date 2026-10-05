import { aggregate, aggregateCohort, measuredCohort, cohortWeights, weightedGeometricMean } from './aggregates';
import { fmtU } from './format';
import { viewData, type ViewCell } from './view-data';
import type { CfgId, MachineId, MetricKey, OtMetricKey } from './data/types';
import type { Scope } from './model';

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
	const catalogue=new Map(viewData.catalogue.map(w=>[w.id,w]));
	const values=h.points.map((point,i)=>{
		const current=point.currentLatency?.[cid];
		if(current && ['exec','compile','inst'].includes(key))return aggregate({...s,snapshot:current},'lat',cid,key==='exec'?3:key==='compile'?0:1)?.v ?? Number.NaN;
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
 if(current && ['exec','compile','inst'].includes(key))return aggregateCohort({...s,snapshot:current},'lat',cid,key==='exec'?3:key==='compile'?0:1).cohort.map(w=>w.id);
 if(['exec','compile','inst'].includes(key)){
  const reference=aggregateCohort({...s,snapshot:'s1'},'lat',cid,key==='exec'?3:key==='compile'?0:1).cohort;
  if(reference.length)return reference.filter(w=>{const c=historyCell(s.machine,w.id,cid,metric,i);return !!c.report&&valid(c);}).map(w=>w.id);
 }
 const recorded=new Set(h.workloads);
 const workloads=viewData.catalogue.filter(w=>recorded.has(w.id)&&(!['exec','compile','inst'].includes(key)||!w.id.startsWith('features/')));
 const requested=[...new Set([...viewData.applicationConfigurations.filter(c=>!s.hide[c]),s.baseline])];
 return measuredCohort(workloads,requested,cid,(w,c)=>historyCell(s.machine,w,c,metric,i)).cohort.map(w=>w.id);
}
export function historyAggregateDetails(s:Scope,cid:CfgId,key:OtMetricKey,i:number):string {
 if(!['exec','compile','inst'].includes(key))return '';
 const capture=viewData.history[s.machine].points[i]?.currentLatency?.[cid]?'Same canonical release capture and workload cohort as the current chart.':'Archived capture.';
 const count=historyCohort(s,cid,key,i).length;
 const reference=aggregateCohort({...s,snapshot:'s1'},'lat',cid,key==='exec'?3:key==='compile'?0:1).cohort.length;
 const coverage=reference?`${count} of ${reference} reference non-feature workloads${count<reference?'; partial coverage':''}`:`${count} successful non-feature workloads`;
 return `Geometric mean of ${coverage}; ${s.weighting} weighting. Reference cohort matches the current chart. ${capture}`;
}


export function historyCallDetails(scope:Scope, cid:CfgId, point:number) {
	const wasmHost=historySeries(scope,cid,'wasmHost')?.[point];
	const hostWasm=historySeries(scope,cid,'hostWasm')?.[point];
	const format=(value:number|undefined)=>value!=null && Number.isFinite(value)?fmtU(value,'ms'):'not measured';
	return `Wasm → host: ${format(wasmHost)} · Host → Wasm: ${format(hostWasm)} · Estimated round trip sums both medians; not a measured nested round trip.`;
}
