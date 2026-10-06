import { viewCell, viewData, type ViewCell } from './view-data';
import type { CfgId } from './data/types';
import type { PerfGroup, Scope } from './model';
import { measuredCohort, cohortWeights, weightedGeometricMean } from './comparison-policy';
export { measuredCohort, cohortWeights, weightedGeometricMean } from './comparison-policy';

export interface Aggregate {
	v:number; r:number; ci:number; ratioInterval?:[number,number]; interval?:[number,number];
	count:number; report:string; reports:string[];
}
const metrics:Record<PerfGroup,(string|null)[]>={lat:['compile','inst','first','steady'],mem:['rssCompile','rssInst','rss',null],code:[null,null,null,'code',null]};
const cache=new Map<string,Aggregate|null>();
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b);return s.length%2?s[s.length>>1]:(s[(s.length>>1)-1]+s[s.length>>1])/2;};
const quantile=(xs:number[],q:number)=>{const s=[...xs].sort((a,b)=>a-b);const p=(s.length-1)*q;return s[Math.floor(p)]+(s[Math.ceil(p)]-s[Math.floor(p)])*(p%1);};

/** The exact current cohort, shared by headline and canonical release history. */
export function aggregateCohort(s:Scope,group:PerfGroup,cid:CfgId,col:number) {
 const metric=metrics[group][col];
 const ids=viewData.applicationConfigurations;
 const selected=[...new Set([...ids.filter(id=>!s.hide[id]),s.baseline])];
 const workloads=group==='lat'?viewData.catalogue.filter(w=>!w.id.startsWith('features/')):viewData.catalogue;
 return measuredCohort(workloads,metric?selected:[],cid,(w,c)=>viewCell(s.machine,s.snapshot || 's1',w,c,metric || ''));
}

/** A host-local shared workload cohort merged from sealed reports; each cell retains its evidence. */
export function aggregate(s:Scope,group:PerfGroup,cid:CfgId,col:number):Aggregate|null {
	const metric=metrics[group][col];
	const ids=viewData.applicationConfigurations;
	const visible=ids.filter(id=>!s.hide[id]);
	const selected=[...new Set([...visible,s.baseline])];
	const key=JSON.stringify([s.machine,s.snapshot || 's1',s.weighting,selected,cid,group,col]);
	if(cache.has(key))return cache.get(key)!;
	const remember=(value:Aggregate|null)=>{if(cache.size>512)cache.clear();cache.set(key,value);return value;};
	if(group==='mem' && col===3) {
		const average=(configuration:CfgId)=>{
			const cells=viewData.catalogue.flatMap(w=>['rssCurrentCompile','rssCurrentInst','rssCurrentFirst','rssCurrent'].map(m=>viewCell(s.machine,s.snapshot || 's1',w.id,configuration,m)))
				.filter(c=>c.st==='ok' && !!c.report && c.v!=null && Number.isFinite(c.v) && c.v>0);
			return {v:cells.length?cells.reduce((sum,c)=>sum+c.v!,0)/cells.length:Number.NaN,
				count:cells.length,reports:[...new Set(cells.map(c=>c.report))]};
		};
		const measured=average(cid),baseline=cid===s.baseline?measured:average(s.baseline);
		if(!measured.count)return remember(null);
		const reports=[...new Set([...measured.reports,...baseline.reports])];
		const report=[...measured.reports].sort((a,b)=>viewData.reports[b].created.localeCompare(viewData.reports[a].created))[0];
		return remember({v:measured.v,r:baseline.count?measured.v/baseline.v:Number.NaN,
			ci:Number.NaN,count:measured.count,report,reports});
	}
	if(!metric)return remember(null);
	const os=s.machine==='m1'?'linux':'darwin';
	const snapshot=s.snapshot || 's1';
	if(group==='lat' && (!ids.includes(cid)||!ids.includes(s.baseline)))return remember(null);
	const cell=(w:string,c:CfgId)=>viewCell(s.machine,snapshot,w,c,metric);
	const {cohort,participants}=aggregateCohort(s,group,cid,col);
	if(!cohort.length)return remember(null);
	const reports=[...new Set(cohort.flatMap(w=>participants.map(c=>cell(w.id,c).report)))];
	if(!reports.length)return remember(null);
	const report=[...reports].sort((a,b)=>viewData.reports[b].created.localeCompare(viewData.reports[a].created))[0];
	const weights=cohortWeights(cohort,s.weighting);
	const columns=(c:CfgId)=>cohort.map(w=>cell(w.id,c));
	const numerator=columns(cid),denominator=columns(s.baseline);
	const mean=(cells:ViewCell[],draw?:number[])=>weightedGeometricMean(cells.map(c=>draw?median(draw.map(j=>c.launchMedians![j])):c.v!),weights);
	const baselineAvailable=participants.includes(s.baseline);
	const value=mean(numerator),base=baselineAvailable?mean(denominator):Number.NaN,ratio=cid===s.baseline?1:value/base;
	const result:Aggregate={v:value,r:ratio,ci:Number.NaN,count:cohort.length,report,reports};
	const n=Math.min(...numerator.map(c=>c.launchMedians?.length || 0));
	const d=Math.min(...denominator.map(c=>c.launchMedians?.length || 0));
	if(n>=2 && group!=='code') {
		// Resample independent launch blocks, preserving workload correlation in a
		// runtime's launch block. Randomness selects recorded observations only.
		let state=2166136261;for(const c of key){state^=c.charCodeAt(0);state=Math.imul(state,16777619);}state=state>>>0 || 1;
		const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
		const values:number[]=[],ratios:number[]=[];
		for(let i=0;i<1024;i++){
			const a=mean(numerator,Array.from({length:n},()=>Math.floor(random()*n)));
			const b=cid===s.baseline?a:baselineAvailable&&d>=2?mean(denominator,Array.from({length:d},()=>Math.floor(random()*d))):Number.NaN;
			values.push(a);if(Number.isFinite(b))ratios.push(a/b);
		}
		result.interval=[quantile(values,.025),quantile(values,.975)];
		if(ratios.length){result.ratioInterval=[quantile(ratios,.025),quantile(ratios,.975)];result.ci=Math.max(Math.abs(ratio-result.ratioInterval[0]),Math.abs(result.ratioInterval[1]-ratio));}
	}
	return remember(result);
}
