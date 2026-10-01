// Derived computations over the snapshot. Everything here is pure: callers pass
// the comparison scope (machine, baseline, visible runtimes) explicitly.
import { CB, CFG, MACH, WF } from './data/runtimes';
import { MET, OTM, OV, REF, SNAPS, ST_OVR, UNIT } from './data/snapshot';
import type { Bench, Cfg, CfgId, MachineId, MetricKey, OtMetricKey, RatioCi, Status } from './data/types';
import { H, fmtU, fx, n0, pct } from './format';

export interface Scope {
	machine: MachineId;
	baseline: CfgId;
	weighting: 'corpus' | 'workload';
	hide: Partial<Record<CfgId, boolean>>;
}

export type PerfGroup = 'lat' | 'mem' | 'code';

export const TOTAL_WORKLOADS = 1284;

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

const perf = (group: PerfGroup, cid: CfgId) => OV[group].vals[cid] as RatioCi[] | null;
export const cov = (cid: CfgId) => OV.cov.vals[cid] as number[];

/** Aggregate ratio vs the baseline config for one overview column, with CI half-width. */
export function ratio(s: Scope, group: PerfGroup, cid: CfgId, col: number) {
	const o = perf(group, cid);
	if (!o || isOff(s, cid)) return null;
	const k = (id: CfgId) => mf(s.machine, id) * (s.weighting === 'workload' && group !== 'code' ? WF[id] : 1);
	const bid = perf(group, s.baseline) && !isOff(s, s.baseline) ? s.baseline : 'A';
	const bb = perf(group, bid)![col][0] * k(bid);
	return { r: (o[col][0] * k(cid)) / bb, ci: (o[col][1] * k(cid)) / bb };
}

/** Aggregate absolute value in the column's unit. */
export function absOf(s: Scope, group: PerfGroup, cid: CfgId, col: number) {
	const o = perf(group, cid);
	if (!o || isOff(s, cid)) return null;
	const k = mf(s.machine, cid) * (s.weighting === 'workload' && group !== 'code' ? WF[cid] : 1);
	return { v: o[col][0] * k * REF[group][col], ci: o[col][1] * k * REF[group][col] };
}

export function disp(s: Scope, group: PerfGroup, cid: CfgId, col: number) {
	const a = absOf(s, group, cid, col);
	return a && { t: fmtU(a.v, UNIT[group]), ci: '± ' + fmtU(a.ci, UNIT[group]).replace(/^0\.0+ /, '0 ') };
}

export type BenchResult = { st: 'ok'; v: number } | { st: Exclude<Status, 'ok'> };

/** One workload × config × metric result, or the reason there is none. */
export function benchVal(s: Scope, b: Bench, cid: CfgId, m: MetricKey, caseF = 1): BenchResult {
	const st = ST_OVR[b.id + '|' + cid + '|' + m] || ST_OVR[b.id + '|' + cid];
	if (isOff(s, cid)) return { st: 'unavail' };
	if (st && st !== 'ok') return { st };
	const o = perf(MET[m].g, cid);
	if (!o) return { st: 'na' };
	const mult = o[MET[m].c][0] * mf(s.machine, cid);
	const base = {
		compile: b.kb * 0.12,
		inst: 0.15 + b.kb * 0.0009,
		first: b.ms * 1.3 + b.kb * 0.01,
		steady: b.ms,
		rss: 18 + b.kb * 0.06,
		code: b.kb * 2.3
	}[m];
	const noise = Math.exp((H(b.id + cid + m) - 0.5) * (m === 'code' ? 0.3 : 0.5));
	const cf = m === 'steady' || m === 'first' ? caseF : 1;
	return { st: 'ok', v: base * mult * noise * cf };
}

/** Steady-execution history value for a config at snapshot `i`. */
export function histVal(cid: CfgId, i: number, seed = '') {
	const base = (OV.lat.vals[cid] as RatioCi[])[3][0];
	let f = 1;
	if (cid === 'A') f = i < 10 ? 1.068 : 1;
	if (cid === 'B') f = i < 10 ? 1.01 : 1;
	if (cid === 'C') f = 1.03 - 0.002 * i;
	if (cid === 'F') f = i >= 13 ? 1 : 0.958;
	if (cid === 'G') f = 1.16 - 0.01 * i;
	return base * f * (1 + (H(seed + cid + 'h' + i) - 0.5) * (seed ? 0.03 : 0.012));
}

/** Weekly series for one metric. `seed` makes a per-workload variant. Null when not applicable. */
export function otSeries(s: Scope, cid: CfgId, key: OtMetricKey, seed = ''): number[] | null {
	const M = OTM[key];
	const g = M.g;
	if (g === 'cov') {
		if (isOff(s, cid)) return null;
		const o = cov(cid);
		return SNAPS.map(
			(p) => o[0] - Math.round((15 - p.i) * H(cid + 'cv') * 0.9 + (p.i < 10 && (cid === 'A' || cid === 'B') ? 3 : 0))
		);
	}
	const o = perf(g, cid);
	if (!o || isOff(s, cid)) return null;
	const lat = (OV.lat.vals[cid] as RatioCi[])[3][0];
	const trend = (i: number) => histVal(cid, i, seed) / lat;
	return SNAPS.map(
		(p) =>
			o[M.c][0] *
			REF[g][M.c] *
			mf(s.machine, cid) *
			(1 + (trend(p.i) - 1) * M.k) *
			(M.key === 'exec' ? 1 : 1 + (H(cid + M.key + p.i) - 0.5) * 0.02)
	);
}

/** Formats a series value and a change between two series values for the metric. */
export function seriesFmt(key: OtMetricKey) {
	const M = OTM[key];
	const isCov = M.g === 'cov';
	const fv = (v: number) => (isCov ? n0(v) + ' / 1,284' : fmtU(v, M.u));
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
		.filter((e): e is { c: Cfg; x: { r: number; ci: number } } => e.x != null && isVisible(s, e.c))
		.sort((a, b) => a.x.r - b.x.r);
	if (!list.length)
		return { label, metric, clear: false as const, versus: 'No selected runtime has this measurement.' };
	const a = list[0];
	const b = list[1] ?? null;
	const clear = !b || a.x.r + a.x.ci < b.x.r - b.x.ci;
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

export function compatCell(total: number, spec: string): CompatCell {
	const [av, fr, ex] = spec.split(':') as [Avail, string?, string?];
	if (av === 'u' || av === '?' || av === 'n') return { av, run: false, total, pass: 0, fail: 0, crash: 0, skip: 0 };
	let crash = 0;
	let skip = 0;
	if (ex) {
		if (ex[0] === 'c') crash = +ex.slice(1);
		if (ex[0] === 's') skip = +ex.slice(1);
	}
	const runnable = total - skip;
	const pass = Math.round(runnable * (fr ? parseFloat(fr) : 1));
	crash = Math.min(crash, runnable - pass);
	return { av, run: true, total, pass, fail: runnable - pass - crash, crash, skip };
}

/** Splits a family result across its sub-families; failures land in one deterministic child. */
export function kidCells(fam: { id: string; total: number; kids: [string, number][]; r: string[] }, ci: number) {
	const cell = compatCell(fam.total, fam.r[ci]);
	const k = fam.kids.length;
	const hit = Math.floor(H(fam.id + ci) * k);
	let used = 0;
	return fam.kids.map(([name, sh], i): CompatCell => {
		const t = i < k - 1 ? Math.round(fam.total * sh) : fam.total - used;
		used += t;
		if (!cell.run) return { ...cell, total: t, name };
		const fail = i === hit ? cell.fail : 0;
		const crash = i === hit ? cell.crash : 0;
		const skip = i === k - 1 ? cell.skip : 0;
		return { av: cell.av, run: true, total: t, pass: Math.max(0, t - fail - crash - skip), fail, crash, skip, name };
	});
}

export const AVAIL: Record<Avail, [string, string]> = {
	d: ['●', 'enabled by default'],
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
