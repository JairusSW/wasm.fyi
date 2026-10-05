import { fmtU } from './format';
import { viewData, type ViewCell } from './view-data';
import type { CfgId, MachineId, MetricKey, OtMetricKey } from './data/types';
import type { Scope } from './model';

export const historyCell=(machine:MachineId,workload:string,cid:CfgId,metric:MetricKey,i:number):ViewCell=>viewData.history[machine].cells[`${workload}|${cid}|${metric}`]?.[i] || {st:'nm',report:''};
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
export function historySegments(values:number[],x:(i:number)=>number,y:(v:number)=>number):string[] {
	const segments:string[]=[];let points:string[]=[];
	for(const [i,v] of values.entries()){
		if(!Number.isFinite(v)){if(points.length)segments.push(points.join(' '));points=[];continue;}
		points.push(x(i).toFixed(1)+','+y(v).toFixed(1));
	}
	if(points.length)segments.push(points.join(' '));return segments;
}

/** A fixed successful cohort across each engine's recorded points; missing points stay gaps. */
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
		return h.points.map((_,i)=>h.workloads.filter(w=>historyCell(s.machine,w,cid,'steady',i).st==='ok').length);
	}
	// Both latency views include all non-feature contracts.
	const nonFeatures=new Set(viewData.catalogue.filter(w=>!w.id.startsWith('features/')).map(w=>w.id));
	const workloads=['exec','compile','inst'].includes(key)?h.workloads.filter(w=>nonFeatures.has(w)):h.workloads;
	const requested=[...new Set([...(Object.keys(viewData.configurations) as CfgId[]).filter(c=>!s.hide[c]),cid,s.baseline])];
	const participants=requested.filter(c=>workloads.some(w=>series(w,c).some(valid)));
	if(!participants.includes(cid))return null;
	const recordedPoints=new Map(participants.map(c=>[c,h.points.map((point,i)=>point.status==='measured'&&workloads.some(w=>valid(historyCell(s.machine,w,c,metric,i))))]));
	const cohort=workloads.filter(w=>participants.every(c=>series(w,c).filter((_,i)=>recordedPoints.get(c)![i]).every(valid)));
	if(!cohort.length)return null;
	const groups=new Map(viewData.catalogue.map(w=>[w.id,w.group]));
	const counts=new Map<string,number>();for(const w of cohort){const g=groups.get(w)!;counts.set(g,(counts.get(g)||0)+1);}
	return h.points.map((point,i)=>point.status!=='measured' || !recordedPoints.get(cid)![i]?Number.NaN:Math.exp(cohort.reduce((total,w)=>total+Math.log(historyCell(s.machine,w,cid,metric,i).v!)*(s.weighting==='workload'?1/cohort.length:1/(counts.size*counts.get(groups.get(w)!)!)),0)));
}


export function historyCallDetails(scope:Scope, cid:CfgId, point:number) {
	const wasmHost=historySeries(scope,cid,'wasmHost')?.[point];
	const hostWasm=historySeries(scope,cid,'hostWasm')?.[point];
	const format=(value:number|undefined)=>value!=null && Number.isFinite(value)?fmtU(value,'ms'):'not measured';
	return `Wasm → host: ${format(wasmHost)} · Host → Wasm: ${format(hostWasm)} · Estimated round trip sums both medians; not a measured nested round trip.`;
}
