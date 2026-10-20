import {leastCoveredReference} from './comparison-policy';
import {compilationCandidate} from './ranking-policy';
import {apiView} from './api/controller.svelte';
import {datasetView} from './api/view.svelte';
import { historySeries } from './history-values';
import { aggregate } from './aggregates';
import { viewCell, viewData } from './view-data';
// Derived computations over the snapshot. Everything here is pure: callers pass
// the comparison scope (machine, baseline, visible runtimes) explicitly.
import { CB, CFG, FEATURE_CFG, MACH, WF, execOf, type Exec } from './data/runtimes';
import { MET, OTM, UNIT } from './data/snapshot';
import type { Bench, Cfg, CfgId, MachineId, MetricKey, OtMetricKey, RatioCi, Status } from './data/types';
import { fmtU, fmtAverage, fmtUGroup, fx, n0, relative, type DeltaFormat } from './format';

export interface Scope {
	machine: MachineId;
	baseline: CfgId;
	weighting: 'corpus' | 'workload';
	cohortMode?: 'shared' | 'per-engine';
	/** Geometric mean (default) or plain mean across workloads. */
	average?: 'geo' | 'mean';
	hide: Partial<Record<CfgId, boolean>>;
	snapshot?: 's1' | 's2';
	exec?: Exec;
}

/** Interpreter translation is not compilation: keep interpreters out of compile metrics unless the scope selects interpreters. */
export const compileExcluded = (s: Scope, c: Cfg, metric: string) =>
	(metric === 'compile' || metric === 'rssCompile') && (s.exec ?? 'compiler') !== 'interpreter' && execOf(c) === 'interpreter';

export type PerfGroup = 'lat' | 'mem' | 'code';

export const totalWorkloads = ()=>viewData.statistics.measuredWorkloads??viewData.catalogue.filter(w=>!w.id.startsWith('features/')).length;
export const TOTAL_WORKLOADS = viewData.catalogue.length;

/** Swatch/identity fields for a config, spread into view rows. */
export const sw = (c: Cfg) => ({
	id: c.id,
	rt: c.rt,
	ver: c.ver,
	be: c.be,
	color: c.col,
	swBg: c.hollow ? 'transparent' : c.col,
	dash: c.hollow ? '4 3' : 'none'
});
export type Sw = ReturnType<typeof sw>;

export const cn = (c: Cfg) => `${c.rt} ${c.be}`;

export const mf = (m: MachineId, id: CfgId) => MACH[m].f[id] ?? 1;
export const isOff = (s: Scope, id: CfgId) => !!MACH[s.machine].off[id];
export const isVisible = (s: Scope, c: Cfg) => {
  if(!viewData.hosts[s.machine].configurations[c.id])return false;
  return !s.hide[c.id];
};
export const visibleCfgs = (s: Scope) => CFG.filter((c) => isVisible(s, c));

let correctnessGeneration=-1;
let correctnessView:typeof datasetView.current|undefined;
const correctnessCache=new Map<string,Bench[]>();
function averagingWorkloads(scope?:Scope):Bench[]{
 const view=datasetView.current;
 if(correctnessView!==view||correctnessGeneration!==datasetView.generation){correctnessCache.clear();correctnessView=view;correctnessGeneration=datasetView.generation}
 const selected=viewData.applicationConfigurations.filter(id=>!scope?.hide[id]&&!!viewData.hosts[scope?.machine||'m1'].configurations[id]).sort((a,b)=>(viewData.configurations[a]||a).localeCompare(viewData.configurations[b]||b));
 const key=JSON.stringify([scope?.machine,scope?.snapshot,scope?.cohortMode,selected]);
 const cached=correctnessCache.get(key);if(cached)return cached;
 const all=viewData.catalogue.filter(w=>!w.id.startsWith('features/'));
 const result=scope?.cohortMode==='shared'?leastCoveredReference(all,selected,(w,c)=>viewCell(scope.machine,scope.snapshot||'s1',w.id,c,'steady').st==='ok',c=>viewData.configurations[c]||c):all;
 if(correctnessCache.size>=64)correctnessCache.clear();correctnessCache.set(key,result);return result;
}
export function correctnessWorkloads(_scope?:Scope):Bench[]{return averagingWorkloads()}
export const cov = (cid: CfgId, scope?:Scope) => {
  if(datasetView.revision)return apiView.coverage[cid]||[0,0,0,0,0];
  const counts=[0,0,0,0,0];
  for(const b of correctnessWorkloads(scope)){
    const c=viewCell(scope?.machine || 'm1',scope?.snapshot || 's1',b.id,cid,'steady');
    const i=c.st==='ok'?0:c.st==='failed'?1:['crashed','timeout'].includes(c.st)?2:['unsupported','disabled'].includes(c.st)?3:4;
    counts[i]++;
  }
  return counts;
};

/** Ratio and uncertainty from independent launch blocks in one locked cohort. */
export function ratio(s:Scope,group:PerfGroup,cid:CfgId,col:number) {
  const a=aggregate(s,group,cid,col);
  return a && Number.isFinite(a.r)?{r:a.r,ci:a.ci,interval:a.ratioInterval,count:a.count,report:a.report}:null;
}
export function absOf(s:Scope,group:PerfGroup,cid:CfgId,col:number) {
  const a=aggregate(s,group,cid,col);
  return a?{v:a.v,ci:a.interval?Math.max(Math.abs(a.v-a.interval[0]),Math.abs(a.interval[1]-a.v)):Number.NaN,interval:a.interval,count:a.count,report:a.report}:null;
}
export function sharedCount(s:Scope,group:PerfGroup='lat',col=3) {
 if(s.cohortMode==='shared'&&group==='lat'&&col===3)return averagingWorkloads(s).length;
  // Shown engines only: a hidden engine's cohort says nothing about the comparison on screen.
  const application=CFG.filter(c=>viewData.applicationConfigurations.includes(c.id)&&!s.hide[c.id]);
  return application.map(c=>aggregate(s,group,c.id,col)).find(a=>a)?.count || 0;
}
export function disp(s:Scope,group:PerfGroup,cid:CfgId,col:number) {
  const a=absOf(s,group,cid,col);
  return a && {t:fmtAverage(a.v,UNIT[group]),ci:a.interval?`95% CI ${fmtU(a.interval[0],UNIT[group])} – ${fmtU(a.interval[1],UNIT[group])}`:'CI unavailable'};
}

const LATENCY_PHASES: MetricKey[] = ['compile', 'inst', 'first', 'steady'];

/** Sum selected latency aggregates using the same cohort and averaging policy as the latency table. */
export function combinedLatency(s: Scope, c: Cfg, indices: number[]) {
	const phases = indices.map((col) => {
		const metric = LATENCY_PHASES[col];
		if (!metric || compileExcluded(s, c, metric)) return null;
		return absOf(s, 'lat', c.id, col);
	});
	if (phases.some((phase) => !phase || !Number.isFinite(phase.v) || phase.v <= 0)) return null;
	const measured = phases as NonNullable<(typeof phases)[number]>[];
	const interval = measured.every((phase) => phase.interval)
		? ([
			measured.reduce((sum, phase) => sum + phase.interval![0], 0),
			measured.reduce((sum, phase) => sum + phase.interval![1], 0)
		] as [number, number])
		: undefined;
	return { total: measured.reduce((sum, phase) => sum + phase.v, 0), parts: measured.map((phase) => phase.v), interval };
}

export type BenchResult = { st: 'ok'; v: number } | { st: Exclude<Status, 'ok'> };

/** One workload × config × metric result, or the reason there is none. */
export function benchVal(s: Scope, b: Bench, cid: CfgId, m: MetricKey, caseF = 1): BenchResult {
  if (isOff(s,cid)) return {st:'unavail'};
  // Case multipliers belonged to the preview. A distinct input needs its own
  // measured contract; never manufacture timing for an uncollected variant.
  if (caseF !== 1) return {st:'nm'};
  const cell=viewCell(s.machine,s.snapshot || 's1',b.id,cid,m);
  if(m==='code'&&cell.st==='unsupported'&&/interpreter/.test(viewData.hosts[s.machine].configurations[cid]?.backend||''))return {st:'na'};
  if(cell.st !== 'ok' || cell.v == null) return {st:cell.st === 'ok'?'nm':cell.st};
  return {st:'ok',v:cell.v};
}

/** Recorded weekly values; NaN marks a gap in a plotted per-workload series. */
export function otSeries(s:Scope,cid:CfgId,key:OtMetricKey,workload=''):number[]|null {
  return historySeries(s,cid,key,workload);
}

/** Formats a series value and a change between two series values for the metric. */
export function seriesFmt(key: OtMetricKey, format: DeltaFormat = 'percent') {
	const M = OTM[key];
	const isCov = M.g === 'cov';
	const fv = (v: number) => (isCov ? n0(v) + ' measured contracts' : (['callTotal','wasmHostLoop','hostWasm'].includes(key)?fmtU:fmtAverage)(v, M.u));
	const chg = (x: number, y: number) =>
		isCov
			? { t: (x - y >= 0 ? '+' : '−') + Math.abs(x - y), good: x > y, flat: x === y }
			: { t: relative(x / y,format), good: x < y, flat: Math.abs(x / y - 1) < 0.02 };
	const col = (r: { flat: boolean; good: boolean }) => (r.flat ? 'var(--fg3)' : r.good ? 'var(--good)' : 'var(--bad)');
	return { fv, chg, col };
}

/** Headline leader for one aggregate: clear only when the 95% intervals do not overlap. */
export function leader(s: Scope, label: string, group: PerfGroup, col: number, metric: MetricKey) {
	const list = CFG.filter(c => viewData.applicationConfigurations.includes(c.id) && compilationCandidate(c.rt,metric) && !compileExcluded(s,c,metric))
		.map((c) => ({ c, x: aggregate(s, group, c.id, col) }))
		.filter((e): e is { c: Cfg; x: NonNullable<ReturnType<typeof aggregate>> } => e.x != null && Number.isFinite(e.x.v) && e.x.v>0 && isVisible(s, e.c))
		.sort((a, b) => a.x.v - b.x.v);
	const top=list;
	const topValues=fmtUGroup(top.map(({c})=>absOf(s,group,c.id,col)?.v ?? null),UNIT[group]);
	const places=top.map(({c,x},i)=>({place:i+1,cfg:c,value:topValues[i] ? '~'+topValues[i] : disp(s,group,c.id,col)!.t,ratio:x.v/top[0].x.v}));
	if (!list.length)
		return { label, metric, places, clear: false as const, versus: 'No selected runtime has this measurement.' };
	const a = list[0];
	const b = list[1] ?? null;
	const clear = !!b && !!a.x.interval && !!b.x.interval && a.x.interval[1] < b.x.interval[0];
	const da = disp(s, group, a.c.id, col)!;
	const db = b ? disp(s, group, b.c.id, col)! : { t: '' };
	const firstText=topValues[0] ? '~'+topValues[0] : da.t;
	const secondText=topValues[1] ? '~'+topValues[1] : db.t;
	return {
		label,
		metric,
		places,
		clear,
		cfg: a.c,
		value: firstText,
		versus: b ? `${cn(a.c)} ${firstText} and ${cn(b.c)} ${secondText} · ${Number.isFinite(a.x.ci)&&Number.isFinite(b.x.ci)?'95% intervals overlap':'comparison interval unavailable'}` : ''
	};
}

/** Headline end-to-end leader: compile + instantiate + first call + one steady call. */
export function endToEndLeader(s: Scope, label = 'Fastest end-to-end') {
	const dependencies = [...LATENCY_PHASES];
	const list = CFG.filter((c) => viewData.applicationConfigurations.includes(c.id) && isVisible(s, c))
		.map((c) => ({ c, x: combinedLatency(s, c, [0, 1, 2, 3]) }))
		.filter((entry): entry is { c: Cfg; x: NonNullable<ReturnType<typeof combinedLatency>> } => entry.x != null)
		.sort((a, b) => a.x.total - b.x.total);
	const values = fmtUGroup(list.map((entry) => entry.x.total), UNIT.lat);
	const places = list.map(({ c, x }, i) => ({ place: i + 1, cfg: c, value: `~${values[i]}`, ratio: x.total / list[0].x.total }));
	if (!list.length) return { label, metric: 'steady' as const, dependencies, places, clear: false as const, versus: 'No selected runtime has all four latency phases.' };
	const [first, second] = list;
	const clear = !!second && !!first.x.interval && !!second.x.interval && first.x.interval[1] < second.x.interval[0];
	return {
		label,
		metric: 'steady' as const,
		dependencies,
		places,
		clear,
		cfg: first.c,
		value: places[0].value,
		versus: second ? `${cn(first.c)} ${places[0].value} and ${cn(second.c)} ${places[1].value}` : ''
	};
}

// ── Spec test results ──────────────────────────────────────────────────────

export type Avail = 'd' | 'f' | 'u' | '?' | 'n';
export interface CompatCell {
	av: Avail;
	run: boolean;
	total: number;
	pass: number;
	fail: number;
	crash: number;
	skip: number;
	name?: string;
}

let featureCatalogue:Bench[]|undefined;
let featureGeneration=-1;
const featureIndex=new Map<string,Bench[]>();
export function featureContracts(family:string) {
 const catalogue=viewData.catalogue;
 if(featureCatalogue!==catalogue||featureGeneration!==datasetView.generation){
  featureCatalogue=catalogue;featureGeneration=datasetView.generation;featureIndex.clear();
  for(const w of catalogue){if(!w.id.startsWith('features/')||w.baseline)continue;const family=w.id.split('/')[1];let list=featureIndex.get(family);if(!list){list=[];featureIndex.set(family,list)}list.push(w)}
 }
 return featureIndex.get(family)||[];
}
export function featureOutcome(s:Scope,w:Bench,cid:CfgId) {
  return viewCell(s.machine,s.snapshot || 's1',w.id,cid,w.evidenceScope==='compile-only'?'compile':w.evidenceScope==='compile-and-instantiate'?'inst':'steady');
}
export function compatCell(family:string,cid:CfgId,s:Scope,workload?:string):CompatCell {
  if(datasetView.revision){
   const candidates=viewData.featureVersions[s.machine].filter(v=>v.id===viewData.configurations[cid]);
   const f=candidates.map(v=>v.features.find(f=>f.id===family)).find(Boolean);
   if(!f)return {av:'?',run:false,total:featureContracts(family).length,pass:0,fail:0,crash:0,skip:0};
   if(workload){const cell=f.contracts.find(c=>c.workload===workload);return {av:cell?'d':'?',run:!!cell,total:1,pass:cell?.status==='passed'?1:0,fail:cell?.status==='failed'?1:0,crash:0,skip:cell?.status==='unsupported'?1:0}}
   return {av:'d',run:true,total:f.total,pass:f.pass,fail:f.failed,crash:0,skip:f.total-f.pass-f.failed};
  }
  const contracts=featureContracts(family).filter(w=>!workload || w.id===workload);
  const result:CompatCell={av:'?',run:false,total:contracts.length,pass:0,fail:0,crash:0,skip:0};
  for(const w of contracts){
    const c=featureOutcome(s,w,cid);
    if(c.st==='ok')result.pass++;
    else if(c.st==='failed')result.fail++;
    else if(c.st==='crashed'||c.st==='timeout')result.crash++;
    else result.skip++;
    if(c.report)result.run=true;
  }
  if(result.run)result.av='d';
  return result;
}
export function kidCells(fam:{id:string;kids:[string,number][]},ci:number,s:Scope) {
  return fam.kids.map(([name])=>({...compatCell(fam.id,FEATURE_CFG[ci].id,s,name),name}));
}

export const AVAIL: Record<Avail, [string, string]> = {
	d: ['●', 'recorded configuration'],
	f: ['⚑', 'requires flag'],
	u: ['—', 'unavailable'],
	'?': ['?', 'unknown'],
	n: ['·', 'not run']
};

export function cellView(c: CompatCell) {
	const AV = AVAIL[c.av];
	if (!c.run) return { glyph: AV[0], text: AV[1], sub: '', subColor: 'var(--fg3)', segs: [], color: 'var(--fg3)' };
	const w = (v: number) => ((v / c.total) * 100).toFixed(2) + '%';
	const bad = c.fail + c.crash;
	return {
		glyph: AV[0],
		text: `${n0(c.pass)}/${n0(c.total)}`,
		color: 'var(--fg)',
		sub:
			bad || c.skip
				? [c.fail ? c.fail + ' fail' : '', c.crash ? c.crash + ' crash' : '', c.skip ? c.skip + ' skip' : '']
						.filter(Boolean)
						.join(' · ')
				: 'all passed',
		subColor: bad ? 'var(--st-fail)' : 'var(--fg3)',
		segs: [
			{ w: w(c.pass), c: 'var(--st-pass)' },
			{ w: w(c.fail), c: 'var(--st-fail)' },
			{ w: w(c.crash), c: 'var(--st-crash)' },
			{ w: w(c.skip), c: 'var(--st-skip)' }
		]
	};
}

export const cfgIndex = (id: CfgId) => FEATURE_CFG.findIndex((c) => c.id === id);
export { CB, fx };
