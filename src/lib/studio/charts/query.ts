// Turns a chart config into a dataset, using the same measured cells as the
// rest of the site. Missing results stay missing: they are counted and listed,
// never coerced to zero or to a slow value.
import { CFG } from '$lib/data/runtimes';
import { ALLB, OTM, SNAPS } from '$lib/data/snapshot';
import { FEATS } from '$lib/data/features';
import type { Bench, Cfg, CfgId, MetricKey, OtMetricKey } from '$lib/data/types';
import { fmtU, shortCount } from '$lib/format';
import { compatCell, featureContracts, isVisible, otSeries, type Scope } from '$lib/model';
import { ordered } from '$lib/order.svelte';
import { viewCell } from '$lib/view-data';
import { check, evaluate, variables, type Node } from '../expr';

/** Four chart types, each answering one kind of question. */
export type ChartKind = 'bar' | 'scatter' | 'heatmap' | 'line';
export const KINDS: [ChartKind, string, string][] = [
	['bar', 'Ranking', 'Which runtime is lowest on one metric?'],
	['scatter', 'Trade-off', 'How do two metrics relate?'],
	['heatmap', 'By workload', 'Where does each runtime win or lose?'],
	['line', 'History', 'How has it changed week to week?']
];

export interface ChartConfig {
	[key: string]: unknown;
	title: string;
	kind: ChartKind;
	/** A metric key, `expr` for a derived metric, or `features` for the feature pass rate. */
	metric: string;
	expr: string;
	unit: string;
	/** Scatter x axis. */
	xMetric: string;
	xExpr: string;
	historyKey: OtMetricKey;
	compare: 'absolute' | 'baseline' | 'best';
	/** Empty = follow the scope bar. */
	configs: string[];
	groups: string[];
	log: boolean;
}

export const CHART_DEFAULTS: ChartConfig = {
	title: 'New chart',
	kind: 'bar',
	metric: 'steady',
	expr: 'compile + inst + first + 999 * steady',
	unit: 'ms',
	xMetric: 'compile',
	xExpr: 'compile + inst + first',
	historyKey: 'exec',
	compare: 'absolute',
	configs: [],
	groups: [],
	log: false
};

/** Raw per-cell metrics available as series and in expressions. */
export const METRIC_VARS: { key: string; label: string; unit: string }[] = [
	{ key: 'compile', label: 'Compilation', unit: 'ms' },
	{ key: 'inst', label: 'Instantiation', unit: 'ms' },
	{ key: 'first', label: 'First call', unit: 'ms' },
	{ key: 'steady', label: 'Steady execution', unit: 'ms' },
	{ key: 'rss', label: 'Peak memory (RSS)', unit: 'MiB' },
	{ key: 'code', label: 'Native code size', unit: 'KiB' }
];
/** Workload properties usable in expressions. */
export const WORKLOAD_VARS = ['kb', 'units'] as const;
export const EXPR_VARS = [...METRIC_VARS.map((m) => m.key), 'rssCompile', 'rssInst', ...WORKLOAD_VARS];
export const UNITS: [string, string][] = [
	['ms', 'Time (ms)'],
	['MiB', 'Memory (MiB)'],
	['KiB', 'Size (KiB)'],
	['', 'Number']
];

export const fmtValue = (v: number, unit: string) =>
	unit === 'ms' || unit === 'MiB' || unit === 'KiB'
		? fmtU(v, unit)
		: unit === 'x'
			? (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + '×'
			: unit === '%'
				? (v * 100).toFixed(1) + '%'
				: Math.abs(v) >= 1e4
					? shortCount(v)
					: Math.abs(v) < 1e-3 && v !== 0
						? v.toExponential(2)
						: String(+v.toPrecision(4));

export interface MetricSpec {
	label: string;
	unit: string;
	node?: Node;
	key?: string;
	error?: string;
}

export function metricSpec(metric: string, expr: string, unit: string): MetricSpec {
	if (metric !== 'expr') {
		const m = METRIC_VARS.find((x) => x.key === metric) ?? METRIC_VARS[3];
		return { label: m.label, unit: m.unit, key: m.key };
	}
	const parsed = check(expr, EXPR_VARS);
	return parsed.ok ? { label: expr, unit, node: parsed.node } : { label: expr, unit, error: parsed.error };
}

/** One workload × config value. */
function cellValue(s: Scope, b: Bench, cid: CfgId, spec: MetricSpec): { v: number | null; st: string } {
	const snapshot = s.snapshot || 's1';
	if (spec.key) {
		const c = viewCell(s.machine, snapshot, b.id, cid, spec.key);
		return { v: c.st === 'ok' && c.v != null && Number.isFinite(c.v) && c.v > 0 ? c.v : null, st: c.st };
	}
	if (!spec.node) return { v: null, st: 'nm' };
	const env: Record<string, number | null> = { kb: b.kb, units: b.unitsPerInvocation ?? null };
	let st = 'ok';
	for (const name of variables(spec.node)) {
		if (name in env) continue;
		const c = viewCell(s.machine, snapshot, b.id, cid, name);
		env[name] = c.st === 'ok' && c.v != null ? c.v : null;
		if (env[name] == null && st === 'ok') st = c.st === 'ok' ? 'nm' : c.st;
	}
	const v = evaluate(spec.node, env);
	return v != null && v > 0 ? { v, st: 'ok' } : { v: null, st: st === 'ok' ? 'nm' : st };
}

const geomean = (xs: number[]) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);

export function chartConfigs(s: Scope, c: ChartConfig): Cfg[] {
	return ordered(c.configs.length ? CFG.filter((x) => c.configs.includes(x.id)) : CFG.filter((x) => isVisible(s, x)));
}

/** Application workloads in the chosen groups. Feature probes have their own metric. */
export function chartWorkloads(c: ChartConfig): Bench[] {
	return ALLB.filter((b) => !b.id.startsWith('features/') && (!c.groups.length || c.groups.includes(b.group)));
}

export const WORKLOAD_GROUPS = [...new Set(ALLB.filter((b) => !b.id.startsWith('features/')).map((b) => b.group))];

export interface Row {
	cfg: Cfg;
	value: number | null;
	n: number;
}
export interface Matrix {
	rows: { id: string; label: string }[];
	cfgs: Cfg[];
	/** values[row][cfg]; null = missing */
	values: (number | null)[][];
	status: string[][];
	/** Rows are workloads, so cells can open the result drawer. */
	workloads?: boolean;
}
export interface Dataset {
	kind: ChartKind;
	unit: string;
	label: string;
	xUnit?: string;
	xLabel?: string;
	rows: Row[];
	matrix?: Matrix;
	points?: { cfg: Cfg; x: number; y: number }[];
	lines?: { cfg: Cfg; values: (number | null)[] }[];
	dates?: string[];
	error?: string;
	note: string;
}

const fail = (c: ChartConfig, error: string): Dataset => ({ kind: c.kind, unit: '', label: '', rows: [], note: '', error });

/** Per-workload matrix of raw values for one metric. */
function matrixOf(s: Scope, c: ChartConfig, spec: MetricSpec, cfgs: Cfg[]) {
	const workloads = chartWorkloads(c);
	const cells = workloads.map((b) => cfgs.map((cfg) => cellValue(s, b, cfg.id, spec)));
	return { workloads, values: cells.map((r) => r.map((x) => x.v)), status: cells.map((r) => r.map((x) => x.st)) };
}

/**
 * Geometric mean per runtime over a shared set: the workloads measured on every
 * runtime that has any data. Runtimes with no data show as not measured. If no
 * workload is shared, each runtime uses its own and the note says so.
 */
function aggregate(values: (number | null)[][], ncfg: number) {
	const has = Array.from({ length: ncfg }, (_, i) => values.some((r) => r[i] != null));
	const shared = values.map((r) => has.some(Boolean) && r.every((v, i) => !has[i] || v != null));
	const cohort = shared.filter(Boolean).length;
	const out = Array.from({ length: ncfg }, (_, i) => {
		const vals = values.filter((r, w) => r[i] != null && (cohort === 0 || shared[w])).map((r) => r[i]!);
		return { value: vals.length ? geomean(vals) : null, n: vals.length };
	});
	return { out, cohort, fellBack: cohort === 0 && has.some(Boolean) };
}

function cohortNote(total: number, cohort: number, fellBack: boolean) {
	return fellBack
		? 'No workload is measured on every runtime, so each uses its own workloads — pick fewer runtimes for a fair comparison.'
		: `Geometric mean over ${cohort} of ${total} workloads measured on every runtime with data.`;
}

export function buildDataset(s: Scope, c: ChartConfig): Dataset {
	const cfgs = chartConfigs(s, c);
	if (!cfgs.length) return fail(c, 'No runtimes selected.');

	// ── History ────────────────────────────────────────────────────────────
	if (c.kind === 'line') {
		const M = OTM[c.historyKey] ?? OTM.exec;
		const lines = cfgs
			.map((cfg) => ({ cfg, values: (otSeries(s, cfg.id, c.historyKey) ?? []).map((v) => (Number.isFinite(v) ? v : null)) }))
			.filter((l) => l.values.some((v) => v != null));
		if (!lines.length) return fail(c, 'No recorded history for these runtimes on this host.');
		return { kind: 'line', unit: M.g === 'cov' ? '' : M.u, label: M.l, rows: [], lines, dates: SNAPS.map((p) => p.date), note: 'Weekly series; gaps are weeks that were not collected.' };
	}

	// ── Feature pass rate ──────────────────────────────────────────────────
	if (c.metric === 'features') {
		const fams = FEATS.filter((f) => featureContracts(f.id).length);
		const values = fams.map((f) =>
			cfgs.map((cfg) => {
				const r = compatCell(f.id, cfg.id, s);
				return r.run && r.total ? r.pass / r.total : null;
			})
		);
		const rows = cfgs
			.map((cfg, i) => {
				const v = values.map((r) => r[i]).filter((x): x is number => x != null);
				return { cfg, value: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, n: v.length };
			})
			.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
		return {
			kind: c.kind === 'heatmap' ? 'heatmap' : 'bar',
			unit: '%',
			label: 'Feature tests passed',
			rows,
			matrix: { rows: fams.map((f) => ({ id: f.id, label: f.name })), cfgs, values, status: values.map((r) => r.map((v) => (v == null ? 'nm' : 'ok'))) },
			note: 'Share of feature-corpus tests passed, averaged across feature families with evidence.'
		};
	}

	// ── Measured results ───────────────────────────────────────────────────
	const spec = metricSpec(c.metric, c.expr, c.unit);
	if (spec.error) return fail(c, spec.error);
	const m = matrixOf(s, c, spec, cfgs);
	if (!m.workloads.length) return fail(c, 'No workloads in the chosen groups.');

	if (c.kind === 'scatter') {
		const xs = metricSpec(c.xMetric, c.xExpr, c.unit);
		if (xs.error) return fail(c, xs.error);
		const mx = matrixOf(s, c, xs, cfgs);
		// One cohort for both axes: keep cells where both metrics exist.
		const both = (src: (number | null)[][], other: (number | null)[][]) => src.map((r, w) => r.map((v, i) => (v != null && other[w][i] != null ? v : null)));
		const ax = aggregate(both(mx.values, m.values), cfgs.length);
		const ay = aggregate(both(m.values, mx.values), cfgs.length);
		const points = cfgs.flatMap((cfg, i) => (ax.out[i].value != null && ay.out[i].value != null ? [{ cfg, x: ax.out[i].value!, y: ay.out[i].value! }] : []));
		if (!points.length) return fail(c, 'No runtime has both metrics measured.');
		return { kind: 'scatter', unit: spec.unit, label: spec.label, xUnit: xs.unit, xLabel: xs.label, rows: [], points, note: cohortNote(m.workloads.length, ay.cohort, ay.fellBack) };
	}

	// Comparison divides each workload by the baseline or by the fastest runtime.
	const base = cfgs.findIndex((x) => x.id === s.baseline);
	const rel = m.values.map((r) => {
		if (c.compare === 'absolute') return r;
		const d = c.compare === 'baseline' ? (base >= 0 ? r[base] : null) : Math.min(...(r.filter((v) => v != null) as number[]));
		return r.map((v) => (v == null || d == null || !Number.isFinite(d) ? null : v / d));
	});
	const unit = c.compare === 'absolute' ? spec.unit : 'x';
	const label = spec.label + (c.compare === 'baseline' ? ' vs baseline' : c.compare === 'best' ? ' vs fastest' : '');

	if (c.kind === 'heatmap') {
		// Most informative rows first: the widest spread across runtimes.
		const order = m.workloads.map((_, w) => w).sort((a, b) => spread(m.values[b]) - spread(m.values[a]));
		return {
			kind: 'heatmap',
			unit,
			label,
			rows: [],
			matrix: { rows: order.map((w) => ({ id: m.workloads[w].id, label: m.workloads[w].id.replace(/^wago\//, '') })), cfgs, values: order.map((w) => rel[w]), status: order.map((w) => m.status[w]), workloads: true },
			note: 'Shaded by distance from each row’s fastest runtime; rows with the widest spread first.'
		};
	}

	const a = aggregate(rel, cfgs.length);
	const rows = cfgs.map((cfg, i) => ({ cfg, value: a.out[i].value, n: a.out[i].n })).sort((x, y) => (x.value ?? Infinity) - (y.value ?? Infinity));
	return { kind: 'bar', unit, label, rows, note: cohortNote(m.workloads.length, a.cohort, a.fellBack) };
}

function spread(row: (number | null)[]) {
	const v = row.filter((x): x is number => x != null && x > 0);
	return v.length < 2 ? -1 : Math.log(Math.max(...v) / Math.min(...v));
}

/** CSV of whatever the chart shows. */
export function toCsv(ds: Dataset): string {
	const esc = (v: unknown) => {
		const s = v == null ? '' : String(v);
		return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	};
	const name = (c: Cfg) => `${c.rt} ${c.be}`;
	const lines: unknown[][] = [];
	if (ds.lines && ds.dates) {
		lines.push(['date', ...ds.lines.map((l) => name(l.cfg))]);
		ds.dates.forEach((d, i) => lines.push([d, ...ds.lines!.map((l) => l.values[i])]));
	} else if (ds.points) {
		lines.push(['runtime', ds.xLabel ?? 'x', ds.label]);
		ds.points.forEach((p) => lines.push([name(p.cfg), p.x, p.y]));
	} else if (ds.kind === 'heatmap' && ds.matrix) {
		lines.push(['row', ...ds.matrix.cfgs.map(name)]);
		ds.matrix.rows.forEach((r, i) => lines.push([r.id, ...ds.matrix!.values[i]]));
	} else {
		lines.push(['runtime', 'value', 'workloads']);
		ds.rows.forEach((r) => lines.push([name(r.cfg), r.value, r.n]));
	}
	return lines.map((l) => l.map(esc).join(',')).join('\n') + '\n';
}

export const isPerfMetric = (m: string): m is MetricKey => METRIC_VARS.some((x) => x.key === m);
