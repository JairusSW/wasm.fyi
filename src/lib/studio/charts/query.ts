// Turns a chart config into a dataset, using the same measured cells as the
// rest of the site. Missing results stay missing: they are counted and listed,
// never coerced to zero or to a slow value.
import { CFG } from '$lib/data/runtimes';
import { ALLB, MET, OTM, SNAPS } from '$lib/data/snapshot';
import type { Bench, Cfg, CfgId, MetricKey, OtMetricKey } from '$lib/data/types';
import { fmtU, shortCount } from '$lib/format';
import { compatCell, featureContracts, isVisible, otSeries, type Scope } from '$lib/model';
import { FEATS } from '$lib/data/features';
import { viewCell } from '$lib/view-data';
import { check, evaluate, variables, type Node } from '../expr';

export type ChartKind = 'bar' | 'columns' | 'heatmap' | 'strip' | 'scatter' | 'line' | 'table' | 'stat';
export type Source = 'results' | 'history' | 'features';
export type Agg = 'geomean' | 'median' | 'mean' | 'min' | 'max' | 'sum';

export interface ChartConfig {
	[key: string]: unknown;
	title: string;
	subtitle: string;
	source: Source;
	kind: ChartKind;
	/** A metric key, or `expr` to use `expr`. */
	metric: string;
	expr: string;
	unit: string;
	xMetric: string;
	xExpr: string;
	xUnit: string;
	per: 'config' | 'workload';
	agg: Agg;
	cohort: 'shared' | 'each';
	normalize: 'none' | 'baseline' | 'best';
	/** Empty = follow the scope bar. */
	configs: string[];
	groups: string[];
	search: string;
	features: boolean;
	historyKey: OtMetricKey;
	family: string;
	log: boolean;
	sort: 'asc' | 'desc' | 'none';
	limit: number;
	height: number;
	labels: boolean;
}

export const CHART_DEFAULTS: ChartConfig = {
	title: 'Custom chart',
	subtitle: '',
	source: 'results',
	kind: 'bar',
	metric: 'steady',
	expr: 'compile + inst + first + 999 * steady',
	unit: 'ms',
	xMetric: 'compile',
	xExpr: 'compile + inst',
	xUnit: 'ms',
	per: 'config',
	agg: 'geomean',
	cohort: 'shared',
	normalize: 'none',
	configs: [],
	groups: [],
	search: '',
	features: false,
	historyKey: 'exec',
	family: '',
	log: false,
	sort: 'asc',
	limit: 0,
	height: 260,
	labels: true
};

/** Raw per-cell metrics available to expressions and as direct series. */
export const METRIC_VARS: { key: string; label: string; unit: string }[] = [
	{ key: 'compile', label: 'Compilation', unit: 'ms' },
	{ key: 'inst', label: 'Instantiation', unit: 'ms' },
	{ key: 'first', label: 'First call', unit: 'ms' },
	{ key: 'steady', label: 'Steady execution', unit: 'ms' },
	{ key: 'rss', label: 'Peak RSS (steady run)', unit: 'MiB' },
	{ key: 'rssCompile', label: 'Peak RSS (compile run)', unit: 'MiB' },
	{ key: 'rssInst', label: 'Peak RSS (instantiate run)', unit: 'MiB' },
	{ key: 'code', label: 'Native code image', unit: 'KiB' }
];
/** Workload properties usable in expressions. */
export const WORKLOAD_VARS = ['kb', 'units'] as const;
export const EXPR_VARS = [...METRIC_VARS.map((m) => m.key), ...WORKLOAD_VARS];
export const UNITS: [string, string][] = [
	['ms', 'time (ms)'],
	['MiB', 'memory (MiB)'],
	['KiB', 'size (KiB)'],
	['x', 'ratio (×)'],
	['', 'plain number']
];

export const fmtValue = (v: number, unit: string) =>
	unit === 'ms' || unit === 'MiB' || unit === 'KiB'
		? fmtU(v, unit)
		: unit === 'x'
			? (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + '×'
			: unit === '%'
				? (v * 100).toFixed(1) + '%'
				: Math.abs(v) >= 1e4
					? shortCount(v) + (unit ? ' ' + unit : '')
					: Math.abs(v) < 1e-3 && v !== 0
						? v.toExponential(2)
					: +v.toPrecision(4) + (unit ? ' ' + unit : '');

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

/** One workload × config value for a metric spec. */
function cellValue(s: Scope, b: Bench, cid: CfgId, spec: MetricSpec): { v: number | null; st: string } {
	const snapshot = s.snapshot || 's1';
	if (spec.key) {
		const c = viewCell(s.machine, snapshot, b.id, cid, spec.key);
		return { v: c.st === 'ok' && c.v != null && Number.isFinite(c.v) ? c.v : null, st: c.st };
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
	return { v, st: v == null ? (st === 'ok' ? 'nm' : st) : 'ok' };
}

const AGG: Record<Agg, (xs: number[]) => number> = {
	geomean: (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length),
	median: (xs) => {
		const s = [...xs].sort((a, b) => a - b);
		return s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2;
	},
	mean: (xs) => xs.reduce((a, x) => a + x, 0) / xs.length,
	min: (xs) => Math.min(...xs),
	max: (xs) => Math.max(...xs),
	sum: (xs) => xs.reduce((a, x) => a + x, 0)
};
export const AGG_LABEL: Record<Agg, string> = {
	geomean: 'Geometric mean',
	median: 'Median',
	mean: 'Mean',
	min: 'Minimum',
	max: 'Maximum',
	sum: 'Sum'
};

export function chartConfigs(s: Scope, c: ChartConfig): Cfg[] {
	const pick = c.configs.length ? CFG.filter((x) => c.configs.includes(x.id)) : CFG;
	return pick.filter((x) => (c.configs.length ? true : isVisible(s, x)));
}

export function chartWorkloads(c: ChartConfig): Bench[] {
	const q = c.search.trim().toLowerCase();
	return ALLB.filter(
		(b) =>
			(c.features || !b.id.startsWith('features/')) &&
			(!c.groups.length || c.groups.includes(b.group)) &&
			(!q || b.id.toLowerCase().includes(q) || b.tags.some((t) => t.toLowerCase().includes(q)))
	);
}

export const WORKLOAD_GROUPS = [...new Set(ALLB.map((b) => b.group))];

export interface Row {
	cfg: Cfg;
	value: number | null;
	/** Raw (un-normalized) value, for labels. */
	raw: number | null;
	n: number;
	missing: number;
}
export interface Matrix {
	workloads: Bench[];
	cfgs: Cfg[];
	/** values[w][c], normalized; null = missing */
	values: (number | null)[][];
	raw: (number | null)[][];
	status: string[][];
}
export interface Dataset {
	source: Source;
	kind: ChartKind;
	unit: string;
	label: string;
	xUnit?: string;
	xLabel?: string;
	rows: Row[];
	matrix?: Matrix;
	points?: { cfg: Cfg; w?: Bench; x: number; y: number }[];
	lines?: { cfg: Cfg; values: (number | null)[] }[];
	dates?: string[];
	error?: string;
	notes: string[];
	cohort: number;
}

function buildMatrix(s: Scope, c: ChartConfig, spec: MetricSpec, cfgs: Cfg[]): Matrix {
	const workloads = chartWorkloads(c);
	const cells = workloads.map((b) => cfgs.map((cfg) => cellValue(s, b, cfg.id, spec)));
	const raw = cells.map((row) => row.map((x) => (x.v != null && x.v > 0 ? x.v : x.v === 0 ? 0 : null)));
	const status = cells.map((row) => row.map((x) => x.st));
	const base = cfgs.findIndex((x) => x.id === s.baseline);
	const values = raw.map((row) => {
		if (c.normalize === 'none') return row;
		const d = c.normalize === 'baseline' ? (base >= 0 ? row[base] : null) : Math.min(...(row.filter((v) => v != null && v > 0) as number[]));
		return row.map((v) => (v == null || d == null || !Number.isFinite(d) || d <= 0 ? null : v / d));
	});
	return { workloads, cfgs, values, raw, status };
}

/**
 * Per-config aggregate. The shared cohort is the workloads measured on every
 * runtime that has any data here; runtimes with no data show as not measured.
 * When even that cohort is empty, each runtime falls back to its own workloads
 * and the dataset says so.
 */
function aggregateRows(m: Matrix, c: ChartConfig): { rows: Row[]; cohort: number; fellBack: boolean } {
	const ok = (w: number, i: number) => m.values[w][i] != null && (c.agg !== 'geomean' || m.values[w][i]! > 0);
	const participates = m.cfgs.map((_, i) => m.workloads.some((_, w) => ok(w, i)));
	const shared = m.workloads.map((_, w) => participates.some(Boolean) && m.cfgs.every((_, i) => !participates[i] || ok(w, i)));
	const cohort = shared.filter(Boolean).length;
	const fellBack = c.cohort === 'shared' && cohort === 0;
	const useShared = c.cohort === 'shared' && !fellBack;
	const rows = m.cfgs.map((cfg, i) => {
		const idx = m.workloads.map((_, w) => w).filter((w) => ok(w, i) && (!useShared || shared[w]));
		const vals = idx.map((w) => m.values[w][i]!);
		const raws = idx.map((w) => m.raw[w][i]!).filter((v) => v > 0 || c.agg !== 'geomean');
		const missing = m.workloads.length - m.workloads.filter((_, w) => ok(w, i)).length;
		return { cfg, value: vals.length ? AGG[c.agg](vals) : null, raw: raws.length ? AGG[c.agg](raws) : null, n: vals.length, missing };
	});
	return { rows, cohort, fellBack };
}

/** Keeps only cells where both matrices have a value, so two metrics share one cohort. */
function jointMask(a: Matrix, b: Matrix): [Matrix, Matrix] {
	const keep = (w: number, i: number) => a.raw[w][i] != null && b.raw[w][i] != null && a.raw[w][i]! > 0 && b.raw[w][i]! > 0;
	const mask = (m: Matrix): Matrix => ({
		...m,
		values: m.values.map((r, w) => r.map((v, i) => (keep(w, i) ? v : null))),
		raw: m.raw.map((r, w) => r.map((v, i) => (keep(w, i) ? v : null)))
	});
	return [mask(a), mask(b)];
}

export function sortRows(rows: Row[], sort: ChartConfig['sort']) {
	if (sort === 'none') return rows;
	return [...rows].sort((a, b) => {
		if (a.value == null) return 1;
		if (b.value == null) return -1;
		return sort === 'asc' ? a.value - b.value : b.value - a.value;
	});
}

export function buildDataset(s: Scope, c: ChartConfig): Dataset {
	const cfgs = chartConfigs(s, c);
	const notes: string[] = [];
	const empty = (error: string): Dataset => ({ source: c.source, kind: c.kind, unit: '', label: '', rows: [], notes, cohort: 0, error });
	if (!cfgs.length) return empty('No runtimes selected. Pick runtimes in the chart settings or the scope bar.');

	if (c.source === 'history') {
		const M = OTM[c.historyKey];
		const lines = cfgs.map((cfg) => ({ cfg, values: (otSeries(s, cfg.id, c.historyKey) ?? []).map((v) => (Number.isFinite(v) ? v : null)) }));
		const live = lines.filter((l) => l.values.some((v) => v != null));
		if (!live.length) return empty('No recorded history for these runtimes on this host.');
		const last = (l: (typeof lines)[number]) => [...l.values].reverse().find((v) => v != null) ?? null;
		const rows = live.map((l) => ({ cfg: l.cfg, value: last(l), raw: last(l), n: l.values.filter((v) => v != null).length, missing: l.values.filter((v) => v == null).length }));
		return {
			source: 'history',
			kind: c.kind === 'table' ? 'table' : 'line',
			unit: M.g === 'cov' ? '' : M.u,
			label: M.l,
			rows,
			lines: live,
			dates: SNAPS.map((p) => p.date),
			notes: ['Weekly retrospective series; gaps are uncollected weeks, not zero.'],
			cohort: SNAPS.length
		};
	}

	if (c.source === 'features') {
		const fams = c.family ? FEATS.filter((f) => f.id === c.family) : FEATS.filter((f) => featureContracts(f.id).length);
		const workloads = fams.map((f) => ({ id: f.id, tags: [], kb: 0, ms: null, group: f.name }) as unknown as Bench);
		const raw = fams.map((f) => cfgs.map((cfg) => {
			const r = compatCell(f.id, cfg.id, s);
			return r.run && r.total ? r.pass / r.total : null;
		}));
		const status = raw.map((row) => row.map((v) => (v == null ? 'nm' : 'ok')));
		const matrix: Matrix = { workloads, cfgs, values: raw, raw, status };
		const rows = cfgs.map((cfg, i) => {
			const vals = raw.map((r) => r[i]).filter((v): v is number => v != null);
			const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
			return { cfg, value: mean, raw: mean, n: vals.length, missing: fams.length - vals.length };
		});
		notes.push(c.family ? 'Share of corpus contracts passed.' : 'Mean share of corpus contracts passed across feature families with collected evidence.');
		return { source: 'features', kind: c.kind === 'heatmap' || c.kind === 'table' ? c.kind : 'bar', unit: '%', label: 'Contracts passed', rows: c.kind === 'bar' ? sortRows(rows, c.sort === 'asc' ? 'desc' : c.sort) : rows, matrix, notes, cohort: fams.length };
	}

	const spec = metricSpec(c.metric, c.expr, c.unit);
	if (spec.error) return empty('Expression error: ' + spec.error);
	const unit = c.normalize === 'none' ? spec.unit : 'x';
	const matrix = buildMatrix(s, c, spec, cfgs);
	if (!matrix.workloads.length) return empty('No workloads match the filters.');
	const { rows, cohort, fellBack } = aggregateRows(matrix, c);
	const noData = rows.filter((r) => r.n === 0).length;
	if (c.normalize === 'baseline') notes.push(`Normalized to the baseline (${cfgs.find((x) => x.id === s.baseline)?.rt ?? s.baseline}) per workload.`);
	if (c.normalize === 'best') notes.push('Normalized to the fastest runtime per workload.');
	if (c.kind === 'strip') {
		/* Each workload is normalized on its own; cohort notes do not apply. */
	} else if (fellBack) notes.push('No workload is measured on every runtime with data, so each runtime uses its own measured workloads — values are not directly comparable. Pick fewer runtimes for a fair shared set.');
	else if (c.cohort === 'shared') notes.push(`Shared set: ${cohort} of ${matrix.workloads.length} workloads measured on every runtime with data.`);
	else notes.push('Each runtime aggregates its own measured workloads; counts differ.');
	if (noData) notes.push(`${noData} runtime${noData > 1 ? 's have' : ' has'} no measurement for this metric.`);

	const ds: Dataset = { source: 'results', kind: c.kind, unit, label: spec.label, rows: sortRows(rows, c.sort), matrix, notes, cohort };

	if (c.kind === 'scatter') {
		const xs = metricSpec(c.xMetric, c.xExpr, c.xUnit);
		if (xs.error) return empty('X expression error: ' + xs.error);
		const [xm, yRaw] = jointMask(buildMatrix(s, { ...c, normalize: 'none' }, xs, cfgs), buildMatrix(s, { ...c, normalize: 'none' }, spec, cfgs));
		ds.xUnit = xs.unit;
		ds.xLabel = xs.label;
		ds.unit = spec.unit;
		if (c.per === 'workload') {
			ds.points = [];
			yRaw.workloads.forEach((w, wi) =>
				cfgs.forEach((cfg, ci) => {
					const x = xm.raw[wi][ci];
					const y = yRaw.raw[wi][ci];
					if (x != null && y != null && x > 0 && y > 0) ds.points!.push({ cfg, w, x, y });
				})
			);
		} else {
			const xr = aggregateRows(xm, { ...c, normalize: 'none' }).rows;
			const yr = aggregateRows(yRaw, { ...c, normalize: 'none' }).rows;
			ds.points = cfgs.flatMap((cfg, i) => (xr[i].value != null && yr[i].value != null ? [{ cfg, x: xr[i].value!, y: yr[i].value! }] : []));
		}
		if (!ds.points.length) return empty('No runtime has both metrics measured for these workloads.');
	}
	if ((c.kind === 'columns' || c.kind === 'heatmap' || c.kind === 'table') && c.per === 'workload' && c.limit > 0) {
		// Keep the workloads with the widest spread first, so a limit keeps the interesting ones.
		const order = matrix.workloads.map((_, w) => w).sort((a, b) => spread(matrix.values[b]) - spread(matrix.values[a]));
		const keep = new Set(order.slice(0, c.limit));
		const pick = <T,>(xs: T[]) => xs.filter((_, w) => keep.has(w));
		ds.matrix = { ...matrix, workloads: pick(matrix.workloads), values: pick(matrix.values), raw: pick(matrix.raw), status: pick(matrix.status) };
		notes.push(`Showing the ${c.limit} workloads with the widest spread.`);
	}
	if (c.kind === 'bar' && c.limit > 0) ds.rows = ds.rows.slice(0, c.limit);
	return ds;
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
	const lines: unknown[][] = [];
	if (ds.lines && ds.dates) {
		lines.push(['date', ...ds.lines.map((l) => `${l.cfg.rt} ${l.cfg.be}`)]);
		ds.dates.forEach((d, i) => lines.push([d, ...ds.lines!.map((l) => l.values[i])]));
	} else if (ds.points) {
		lines.push(['runtime', 'backend', 'workload', ds.xLabel ?? 'x', ds.label]);
		ds.points.forEach((p) => lines.push([p.cfg.rt, p.cfg.be, p.w?.id ?? '', p.x, p.y]));
	} else if (ds.matrix && (ds.kind === 'heatmap' || ds.kind === 'columns' || ds.kind === 'table' || ds.kind === 'strip')) {
		lines.push(['workload', ...ds.matrix.cfgs.map((c) => `${c.rt} ${c.be}`)]);
		ds.matrix.workloads.forEach((w, i) => lines.push([w.id, ...ds.matrix!.values[i]]));
	} else {
		lines.push(['runtime', 'backend', 'value', 'workloads', 'missing']);
		ds.rows.forEach((r) => lines.push([r.cfg.rt, r.cfg.be, r.value, r.n, r.missing]));
	}
	return lines.map((l) => l.map(esc).join(',')).join('\n') + '\n';
}

export const isPerfMetric = (m: string): m is MetricKey => m in MET;
