import { viewCell, viewData, type ViewCell } from './view-data';
import type { CfgId } from './data/types';
import type { PerfGroup, Scope } from './model';

export interface Aggregate {
	v:number; r:number; ci:number; ratioInterval?:[number,number]; interval?:[number,number];
	count:number; report:string;
}
const metrics:Record<PerfGroup,(string|null)[]>={lat:['compile','inst','first','steady'],mem:['rssCompile','rssInst','rss',null],code:[null,null,null,'code',null]};
const cache=new Map<string,Aggregate|null>();
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b);return s.length%2?s[s.length>>1]:(s[(s.length>>1)-1]+s[s.length>>1])/2;};
const quantile=(xs:number[],q:number)=>{const s=[...xs].sort((a,b)=>a-b);const p=(s.length-1)*q;return s[Math.floor(p)]+(s[Math.ceil(p)]-s[Math.floor(p)])*(p%1);};

/** One coherent locked report, a fixed successful shared cohort, no fallback baseline. */
export function aggregate(s:Scope,group:PerfGroup,cid:CfgId,col:number):Aggregate|null {
	const metric=metrics[group][col];if(!metric)return null;
	const ids=Object.keys(viewData.configurations) as CfgId[];
	const visible=ids.filter(id=>!s.hide[id]);
	const selected=[...new Set([...visible,s.baseline])];
	const key=JSON.stringify([s.machine,s.snapshot || 's1',s.weighting,selected,cid,group,col]);
	if(cache.has(key))return cache.get(key)!;
	const remember=(value:Aggregate|null)=>{if(cache.size>512)cache.clear();cache.set(key,value);return value;};
	const os=s.machine==='m1'?'linux':'darwin';
	const snapshot=s.snapshot || 's1';
	const candidate=Object.entries(viewData.reports).find(([id,r])=>r.host===os && selected.every(c=>r.configurations.includes(viewData.configurations[c])) && viewData.catalogue.some(w=>viewCell(s.machine,snapshot,w.id,selected[0],metric).report===id));
	if(!candidate)return remember(null);
	const [report]=candidate;
	const cell=(w:string,c:CfgId)=>viewCell(s.machine,snapshot,w,c,metric);
	const available=(c:ViewCell)=>c.report===report && c.st==='ok' && c.v!=null && Number.isFinite(c.v) && c.v>0;
	// An unavailable code/memory collector does not become zero or a slow result.
	const participants=group==='lat'?selected:selected.filter(c=>viewData.catalogue.some(w=>available(cell(w.id,c))));
	if(!participants.includes(cid))return remember(null);
	const cohort=viewData.catalogue.filter(w=>participants.every(c=>available(cell(w.id,c))));
	if(!cohort.length)return remember(null);
	const groupCounts=new Map<string,number>();for(const w of cohort)groupCounts.set(w.group,(groupCounts.get(w.group)||0)+1);
	const weights=cohort.map(w=>s.weighting==='workload'?1/cohort.length:1/(groupCounts.size*groupCounts.get(w.group)!));
	const columns=(c:CfgId)=>cohort.map(w=>cell(w.id,c));
	const numerator=columns(cid),denominator=columns(s.baseline);
	const mean=(cells:ViewCell[],draw?:number[])=>Math.exp(cells.reduce((sum,c,i)=>sum+weights[i]*Math.log(draw?median(draw.map(j=>c.launchMedians![j])):c.v!),0));
	const baselineAvailable=participants.includes(s.baseline);
	const value=mean(numerator),base=baselineAvailable?mean(denominator):Number.NaN,ratio=cid===s.baseline?1:value/base;
	const result:Aggregate={v:value,r:ratio,ci:Number.NaN,count:cohort.length,report};
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
