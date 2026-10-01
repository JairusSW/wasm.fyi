import { historySeries } from './history-values';
import { aggregate } from './aggregates';
import { viewCell, viewData } from './view-data';
// Derived computations over the snapshot. Everything here is pure: callers pass
// the comparison scope (machine, baseline, visible runtimes) explicitly.
import { CB, CFG, MACH, WF } from './data/runtimes';
import { MET, OTM, UNIT } from './data/snapshot';
import type { Bench, Cfg, CfgId, MachineId, MetricKey, OtMetricKey, RatioCi, Status } from './data/types';
import { fmtU, fx, n0, pct } from './format';

export interface Scope {
	machine: MachineId;
	baseline: CfgId;
	weighting: 'corpus' | 'workload';
	hide: Partial<Record<CfgId, boolean>>;
	snapshot?: 's1' | 's2';
}

export type PerfGroup = 'lat' | 'mem' | 'code';

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
export const isVisible = (s: Scope, c: Cfg) => !s.hide[c.id];
export const visibleCfgs = (s: Scope) => CFG.filter((c) => isVisible(s, c));

export const cov = (cid: CfgId, scope?:Scope) => {
  const counts=[0,0,0,0,0];
  for(const b of viewData.catalogue){
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
  return CFG.map(c=>aggregate(s,group,c.id,col)).find(a=>a)?.count || 0;
}
export function disp(s:Scope,group:PerfGroup,cid:CfgId,col:number) {
  const a=absOf(s,group,cid,col);
  return a && {t:fmtU(a.v,UNIT[group]),ci:a.interval?`95% CI ${fmtU(a.interval[0],UNIT[group])} – ${fmtU(a.interval[1],UNIT[group])}`:'CI unavailable'};
}

export type BenchResult = { st: 'ok'; v: number } | { st: Exclude<Status, 'ok'> };

/** One workload × config × metric result, or the reason there is none. */
export function benchVal(s: Scope, b: Bench, cid: CfgId, m: MetricKey, caseF = 1): BenchResult {
  if (isOff(s,cid)) return {st:'unavail'};
  // Case multipliers belonged to the preview. A distinct input needs its own
  // measured contract; never manufacture timing for an uncollected variant.
  if (caseF !== 1) return {st:'nm'};
  const cell=viewCell(s.machine,s.snapshot || 's1',b.id,cid,m);
  if(cell.st !== 'ok' || cell.v == null) return {st:cell.st === 'ok'?'nm':cell.st};
  return {st:'ok',v:cell.v};
}

/** Recorded weekly values; NaN marks a gap in a plotted per-workload series. */
export function otSeries(s:Scope,cid:CfgId,key:OtMetricKey,workload=''):number[]|null {
  return historySeries(s,cid,key,workload);
}

/** Formats a series value and a change between two series values for the metric. */
export function seriesFmt(key: OtMetricKey) {
	const M = OTM[key];
	const isCov = M.g === 'cov';
	const fv = (v: number) => (isCov ? n0(v) + ' measured contracts' : fmtU(v, M.u));
	const chg = (x: number, y: number) =>
		isCov
			? { t: (x - y >= 0 ? '+' : '−') + Math.abs(x - y), good: x > y, flat: x === y }
			: { t: pct(x / y - 1), good: x < y, flat: Math.abs(x / y - 1) < 0.02 };
	const col = (r: { flat: boolean; good: boolean }) => (r.flat ? 'var(--fg3)' : r.good ? 'var(--good)' : 'var(--bad)');
	return { fv, chg, col };
}

/** Headline leader for one aggregate: clear only when the 95% intervals do not overlap. */
export function leader(s: Scope, label: string, group: PerfGroup, col: number, metric: MetricKey) {
	const list = CFG.map((c) => ({ c, x: ratio(s, group, c.id, col) }))
		.filter((e): e is { c: Cfg; x: NonNullable<ReturnType<typeof ratio>> } => e.x != null && isVisible(s, e.c))
		.sort((a, b) => a.x.r - b.x.r);
	if (!list.length)
		return { label, metric, clear: false as const, versus: 'No selected runtime has this measurement.' };
	const a = list[0];
	const b = list[1] ?? null;
	const clear = !!b && Number.isFinite(a.x.ci) && Number.isFinite(b.x.ci) && a.x.r + a.x.ci < b.x.r - b.x.ci;
	const da = disp(s, group, a.c.id, col)!;
	const db = b ? disp(s, group, b.c.id, col)! : { t: '' };
	return {
		label,
		metric,
		clear,
		cfg: a.c,
		value: da.t,
		versus: b ? `${cn(a.c)} ${da.t} and ${cn(b.c)} ${db.t} — 95% intervals overlap` : ''
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

export function featureContracts(family:string) {
  return viewData.catalogue.filter(w=>w.id.startsWith('features/'+family+'/') && !w.baseline);
}
export function featureOutcome(s:Scope,w:Bench,cid:CfgId) {
  return viewCell(s.machine,s.snapshot || 's1',w.id,cid,w.evidenceScope==='compile-only'?'compile':w.evidenceScope==='compile-and-instantiate'?'inst':'steady');
}
export function compatCell(family:string,cid:CfgId,s:Scope,workload?:string):CompatCell {
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
  return fam.kids.map(([name])=>({...compatCell(fam.id,CFG[ci].id,s,name),name}));
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

export const cfgIndex = (id: CfgId) => CFG.findIndex((c) => c.id === id);
export { CB, fx };
