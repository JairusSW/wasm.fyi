// Every block the studio can place, with its settings schema, plus ready-made
// templates and the default layout of each page. Default layouts reproduce the
// site as designed; customizations are stored per page on top of them.
import type { Component } from 'svelte';
import { CFG } from '$lib/data/runtimes';
import { FEATS } from '$lib/data/features';
import { OTM, OTM_KEYS } from '$lib/data/snapshot';
import { EXPR_VARS, CHART_DEFAULTS, METRIC_VARS, UNITS, WORKLOAD_GROUPS, type ChartConfig } from './charts/query';
import { check, FUNCTIONS } from './expr';
import type { BlockConfig, BlockDef, BlockProps, Field, Layout, Template } from './types';

import ChartBlock from './blocks/ChartBlock.svelte';
import Hero from './blocks/home/Hero.svelte';
import Stats from './blocks/home/Stats.svelte';
import Areas from './blocks/home/Areas.svelte';
import Proposals from './blocks/home/Proposals.svelte';
import Methodology from './blocks/home/Methodology.svelte';
import RecentChanges from './blocks/home/RecentChanges.svelte';
import Cta from './blocks/home/Cta.svelte';
import BenchHeader from './blocks/bench/BenchHeader.svelte';
import Leaders from './blocks/bench/Leaders.svelte';
import Matrix from './blocks/bench/Matrix.svelte';
import OverTime from './blocks/bench/OverTime.svelte';
import Workloads from './blocks/bench/Workloads.svelte';
import Note from './blocks/content/Note.svelte';
import SectionHeading from './blocks/content/SectionHeading.svelte';
import Spacer from './blocks/content/Spacer.svelte';
import History from './blocks/pages/History.svelte';
import Features from './blocks/pages/Features.svelte';
import Compare from './blocks/pages/Compare.svelte';
import BenchDetail from './blocks/pages/BenchDetail.svelte';
import ProposalOverview from './blocks/pages/ProposalOverview.svelte';
import ProposalPerformance from './blocks/pages/ProposalPerformance.svelte';

const comp = <C extends BlockConfig>(c: unknown) => c as Component<BlockProps<C>>;
const exprVal = (v: unknown) => {
	const r = check(String(v ?? ''), EXPR_VARS);
	return r.ok ? null : r.error;
};

const METRIC_OPTIONS: [string, string][] = [...METRIC_VARS.map((m) => [m.key, m.label] as [string, string]), ['expr', 'Custom expression…']];
const KINDS_BY_SOURCE: Record<ChartConfig['source'], [string, string][]> = {
	results: [
		['bar', 'Ranked bars'],
		['columns', 'Grouped columns'],
		['heatmap', 'Heatmap'],
		['strip', 'Spread (strip plot)'],
		['scatter', 'Scatter'],
		['table', 'Table'],
		['stat', 'Single stat']
	],
	history: [
		['line', 'Line'],
		['table', 'Latest values']
	],
	features: [
		['bar', 'Ranked bars'],
		['heatmap', 'Heatmap'],
		['table', 'Table']
	]
};
const results = (c: ChartConfig) => c.source === 'results';

export const EXPR_HELP = `Variables: ${EXPR_VARS.join(', ')} (latency in ms, memory in MiB, code in KiB, kb = artifact size, units = work units per invocation). Functions: ${Object.keys(FUNCTIONS).join(', ')}. A missing input makes the result missing, never zero.`;

const chartFields: Field<ChartConfig>[] = [
	{ key: 'title', label: 'Title', type: 'text', section: 'Chart' },
	{ key: 'subtitle', label: 'Subtitle', type: 'text', placeholder: 'Generated from the settings', section: 'Chart' },
	{
		key: 'source',
		label: 'Data',
		type: 'select',
		section: 'Chart',
		options: [
			['results', 'Benchmark results (latest snapshot)'],
			['history', 'History (weekly series)'],
			['features', 'Feature corpus results']
		]
	},
	{ key: 'kind', label: 'Chart type', type: 'select', section: 'Chart', options: (c) => KINDS_BY_SOURCE[c.source] },
	{ key: 'metric', label: 'Metric', type: 'select', section: 'Measure', options: METRIC_OPTIONS, when: results },
	{ key: 'expr', label: 'Expression', type: 'expr', section: 'Measure', help: EXPR_HELP, when: (c) => results(c) && c.metric === 'expr', validate: exprVal },
	{ key: 'unit', label: 'Expression unit', type: 'select', section: 'Measure', options: UNITS, when: (c) => results(c) && c.metric === 'expr' },
	{ key: 'xMetric', label: 'X axis metric', type: 'select', section: 'Measure', options: METRIC_OPTIONS, when: (c) => results(c) && c.kind === 'scatter' },
	{ key: 'xExpr', label: 'X expression', type: 'expr', section: 'Measure', help: EXPR_HELP, when: (c) => results(c) && c.kind === 'scatter' && c.xMetric === 'expr', validate: exprVal },
	{ key: 'xUnit', label: 'X unit', type: 'select', section: 'Measure', options: UNITS, when: (c) => results(c) && c.kind === 'scatter' && c.xMetric === 'expr' },
	{
		key: 'historyKey',
		label: 'History metric',
		type: 'select',
		section: 'Measure',
		options: OTM_KEYS.map((k) => [k, OTM[k].l]),
		when: (c) => c.source === 'history'
	},
	{
		key: 'family',
		label: 'Feature family',
		type: 'select',
		section: 'Measure',
		options: [['', 'All families'], ...FEATS.map((f) => [f.id, f.name] as [string, string])],
		when: (c) => c.source === 'features'
	},
	{
		key: 'per',
		label: 'Granularity',
		type: 'select',
		section: 'Measure',
		options: [
			['config', 'One value per runtime (aggregate)'],
			['workload', 'Per workload']
		],
		when: (c) => results(c) && ['scatter', 'heatmap', 'table', 'columns'].includes(c.kind)
	},
	{
		key: 'agg',
		label: 'Aggregate',
		type: 'select',
		section: 'Measure',
		options: [
			['geomean', 'Geometric mean'],
			['median', 'Median'],
			['mean', 'Mean'],
			['min', 'Minimum'],
			['max', 'Maximum'],
			['sum', 'Sum']
		],
		when: (c) => results(c) && (['bar', 'stat'].includes(c.kind) || c.per === 'config')
	},
	{
		key: 'cohort',
		label: 'Workload set',
		type: 'select',
		section: 'Measure',
		options: [
			['shared', 'Shared: measured on every runtime'],
			['each', 'Each runtime’s own measured workloads']
		],
		when: results,
		help: 'Shared cohorts keep comparisons fair; per-runtime sets can mix different workloads.'
	},
	{
		key: 'normalize',
		label: 'Normalize',
		type: 'select',
		section: 'Measure',
		options: [
			['none', 'Absolute values'],
			['baseline', 'Ratio to baseline runtime'],
			['best', 'Ratio to fastest per workload']
		],
		when: (c) => results(c) && c.kind !== 'scatter'
	},
	{ key: 'configs', label: 'Runtimes', type: 'configs', section: 'Filter', help: 'None selected follows the scope bar.' },
	{
		key: 'groups',
		label: 'Workload groups',
		type: 'chips',
		section: 'Filter',
		options: WORKLOAD_GROUPS.map((g) => [g, g]),
		when: results,
		help: 'None selected includes every group.'
	},
	{ key: 'search', label: 'Workload filter', type: 'text', section: 'Filter', placeholder: 'id or tag contains…', when: results },
	{ key: 'features', label: 'Include feature probes', type: 'toggle', section: 'Filter', when: results },
	{
		key: 'sort',
		label: 'Sort',
		type: 'select',
		section: 'Display',
		options: [
			['asc', 'Ascending'],
			['desc', 'Descending'],
			['none', 'Fixed order']
		],
		when: (c) => ['bar', 'stat', 'table'].includes(c.kind)
	},
	{ key: 'limit', label: 'Limit (0 = all)', type: 'number', min: 0, max: 200, section: 'Display', when: (c) => results(c) && ['bar', 'columns', 'heatmap', 'table'].includes(c.kind) },
	{ key: 'log', label: 'Log scale', type: 'toggle', section: 'Display', when: (c) => ['bar', 'columns', 'scatter', 'line'].includes(c.kind) },
	{ key: 'labels', label: 'Value labels', type: 'toggle', section: 'Display', when: (c) => ['bar', 'scatter'].includes(c.kind) },
	{ key: 'height', label: 'Height', type: 'range', min: 140, max: 640, step: 20, section: 'Display', when: (c) => ['columns', 'scatter', 'line', 'heatmap'].includes(c.kind) }
];
const text = (key: string, label: string, type: 'text' | 'textarea' = 'text') => ({ key, label, type }) as Field;

export const BLOCKS: Record<string, BlockDef<any>> = {
	chart: {
		type: 'chart',
		label: 'Chart',
		description: 'Build any chart from measured results, history or feature evidence. Supports derived metrics.',
		category: 'Charts',
		component: comp<ChartConfig>(ChartBlock),
		defaults: () => structuredClone(CHART_DEFAULTS),
		span: 6,
		minSpan: 3,
		fields: chartFields,
		title: (c: ChartConfig) => c.title
	},
	note: {
		type: 'note',
		label: 'Note',
		description: 'Text with a small Markdown subset: headings, lists, bold, code and links.',
		category: 'Content',
		component: comp(Note),
		defaults: () => ({ text: '### Notes\nWrite **anything** here — `code`, lists and [links](/benchmarks) work.', style: 'panel' }),
		span: 6,
		minSpan: 2,
		fields: [
			text('text', 'Text', 'textarea'),
			{ key: 'style', label: 'Style', type: 'select', options: [['plain', 'Plain'], ['panel', 'Panel'], ['callout', 'Callout']] }
		],
		title: (c) => String(c.text ?? '').split('\n')[0].replace(/^#+\s*/, '').slice(0, 40) || 'Note'
	},
	heading: {
		type: 'heading',
		label: 'Section heading',
		description: 'A titled divider to group blocks.',
		category: 'Content',
		component: comp(SectionHeading),
		defaults: () => ({ eyebrow: 'Section', title: 'New section', text: '', rule: true }),
		span: 12,
		fields: [text('eyebrow', 'Eyebrow'), text('title', 'Title'), text('text', 'Text', 'textarea'), { key: 'rule', label: 'Top rule', type: 'toggle' }],
		title: (c) => String(c.title || 'Section heading')
	},
	spacer: {
		type: 'spacer',
		label: 'Spacer',
		description: 'Empty space or a thin rule.',
		category: 'Content',
		component: comp(Spacer),
		defaults: () => ({ size: 24, line: false }),
		span: 12,
		minSpan: 1,
		fields: [{ key: 'size', label: 'Height', type: 'range', min: 4, max: 160, step: 4 }, { key: 'line', label: 'Draw a rule', type: 'toggle' }]
	},
	hero: {
		type: 'hero',
		label: 'Hero',
		description: 'Headline, introduction and the fastest-execution leaderboard.',
		category: 'Overview',
		component: comp(Hero),
		defaults: () => ({
			eyebrow: 'wasm.fyi',
			title: 'The reference for WebAssembly runtimes.',
			lead: 'Independent benchmarks, feature support and proposal performance. Every number links to the run that produced it.',
			board: true,
			rows: 5
		}),
		span: 12,
		minSpan: 6,
		fields: [
			text('eyebrow', 'Eyebrow'),
			text('title', 'Headline'),
			text('lead', 'Introduction', 'textarea'),
			{ key: 'board', label: 'Show leaderboard', type: 'toggle' },
			{ key: 'rows', label: 'Leaderboard rows', type: 'number', min: 1, max: 19, when: (c) => !!c.board }
		]
	},
	stats: {
		type: 'stats',
		label: 'Key numbers',
		description: 'Counters for runtimes, contracts, samples and more.',
		category: 'Overview',
		component: comp(Stats),
		defaults: () => ({ show: ['runtimes', 'contracts', 'samples', 'features', 'machines'] }),
		span: 12,
		minSpan: 4,
		fields: [
			{
				key: 'show',
				label: 'Counters',
				type: 'chips',
				options: [
					['runtimes', 'Runtimes'],
					['contracts', 'Contracts'],
					['samples', 'Timing samples'],
					['features', 'Feature families'],
					['machines', 'Machines'],
					['reports', 'Reports']
				]
			}
		]
	},
	areas: {
		type: 'areas',
		label: 'Site areas',
		description: 'Cards linking to Benchmarks, History, Features and Studio.',
		category: 'Overview',
		component: comp(Areas),
		defaults: () => ({ eyebrow: "What's inside", title: 'One place to answer “which runtime, and why?”' }),
		span: 12,
		minSpan: 6,
		fields: [text('eyebrow', 'Eyebrow'), text('title', 'Title')]
	},
	proposals: {
		type: 'proposals',
		label: 'Proposal cards',
		description: 'Links to the SIMD, WasmGC, Memory64 and Threads pages.',
		category: 'Overview',
		component: comp(Proposals),
		defaults: () => ({
			eyebrow: 'Proposals',
			title: 'Beyond the checkbox.',
			lede: 'Each major proposal has a permanent page combining status, adoption and measured performance.'
		}),
		span: 12,
		minSpan: 4,
		fields: [text('eyebrow', 'Eyebrow'), text('title', 'Title'), text('lede', 'Text', 'textarea')]
	},
	methodology: {
		type: 'methodology',
		label: 'Methodology',
		description: 'The three measurement principles.',
		category: 'Overview',
		component: comp(Methodology),
		defaults: () => ({ eyebrow: 'Methodology', title: 'Built to be checked.' }),
		span: 6,
		minSpan: 4,
		fields: [text('eyebrow', 'Eyebrow'), text('title', 'Title')]
	},
	recent: {
		type: 'recent',
		label: 'Recent changes',
		description: 'Latest history events.',
		category: 'History',
		component: comp(RecentChanges),
		defaults: () => ({ eyebrow: 'Recent changes', title: 'What moved this quarter.', limit: 0 }),
		span: 6,
		minSpan: 4,
		fields: [text('eyebrow', 'Eyebrow'), text('title', 'Title'), { key: 'limit', label: 'Events (0 = all)', type: 'number', min: 0, max: 100 }]
	},
	cta: {
		type: 'cta',
		label: 'Call to action',
		description: 'A banner with a button.',
		category: 'Content',
		component: comp(Cta),
		defaults: () => ({
			title: 'Missing a runtime or a program?',
			text: 'wasm.fyi is open. Submit a runtime adapter, add a workload, or reproduce a result on your own hardware.',
			label: 'Contribute on GitHub',
			href: 'https://github.com/JairusSW/wasm.fyi'
		}),
		span: 12,
		minSpan: 4,
		fields: [
			text('title', 'Title'),
			text('text', 'Text', 'textarea'),
			text('label', 'Button label'),
			{ key: 'href', label: 'Button link', type: 'text', validate: (v) => (/^(https?:\/\/|\/(?!\/))/.test(String(v)) ? null : 'Use an https:// or site-relative link') }
		]
	},
	benchHeader: {
		type: 'benchHeader',
		label: 'Benchmarks header',
		description: 'Page title with the shared-workload count.',
		category: 'Benchmarks',
		component: comp(BenchHeader),
		defaults: () => ({ title: 'Benchmarks' }),
		span: 12,
		fields: [text('title', 'Title')]
	},
	leaders: {
		type: 'leaders',
		label: 'Headline leaders',
		description: 'Top three runtimes per phase with confidence intervals.',
		category: 'Benchmarks',
		component: comp(Leaders),
		defaults: () => ({}),
		span: 12,
		minSpan: 6
	},
	matrix: {
		type: 'matrix',
		label: 'Aggregate matrix',
		description: 'Latency, memory, machine code and correctness per runtime.',
		category: 'Benchmarks',
		component: comp(Matrix),
		defaults: () => ({}),
		span: 12,
		minSpan: 8
	},
	overTime: {
		type: 'overTime',
		label: 'Over time',
		description: 'Weekly sparklines per runtime for any metric.',
		category: 'History',
		component: comp(OverTime),
		defaults: () => ({}),
		span: 12,
		minSpan: 8
	},
	workloads: {
		type: 'workloads',
		label: 'All workloads',
		description: 'Per-workload matrix with filters, sorting and result drawers.',
		category: 'Benchmarks',
		component: comp(Workloads),
		defaults: () => ({}),
		span: 12,
		minSpan: 8,
		unique: true
	},
	history: {
		type: 'history',
		label: 'History explorer',
		description: 'Interactive history chart with the change report.',
		category: 'History',
		component: comp(History),
		defaults: () => ({}),
		span: 12,
		minSpan: 8,
		unique: true
	},
	features: {
		type: 'features',
		label: 'Feature explorer',
		description: 'Support matrix, spec tests and feature performance.',
		category: 'Features',
		component: comp(Features),
		defaults: () => ({}),
		span: 12,
		minSpan: 8,
		unique: true
	},
	compare: {
		type: 'compare',
		label: 'Startup vs throughput model',
		description: 'Estimated total cost as invocations grow.',
		category: 'Benchmarks',
		component: comp(Compare),
		defaults: () => ({}),
		span: 12,
		minSpan: 8,
		unique: true
	},
	proposalOverview: {
		type: 'proposalOverview',
		label: 'Proposal status & adoption',
		description: 'Phase, history, browsers, toolchains and runtimes for this proposal.',
		category: 'Page',
		component: comp(ProposalOverview),
		defaults: () => ({}),
		span: 12,
		minSpan: 8,
		requires: 'proposal',
		unique: true
	},
	proposalPerformance: {
		type: 'proposalPerformance',
		label: 'Proposal performance',
		description: 'Measured performance for this proposal.',
		category: 'Page',
		component: comp(ProposalPerformance),
		defaults: () => ({}),
		span: 12,
		minSpan: 8,
		requires: 'proposal',
		unique: true
	},
	benchDetail: {
		type: 'benchDetail',
		label: 'Workload detail',
		description: 'Latency, memory, code, history and run details for this workload.',
		category: 'Page',
		component: comp(BenchDetail),
		defaults: () => ({}),
		span: 12,
		minSpan: 8,
		requires: 'bench',
		unique: true
	}
};

const chart = (patch: Partial<ChartConfig>): ChartConfig => ({ ...structuredClone(CHART_DEFAULTS), ...patch });

/** Pre-configured charts shown in the library. */
export const TEMPLATES: Template[] = [
	{
		id: 'tpl-startup-vs-throughput',
		type: 'chart',
		label: 'Startup vs throughput',
		description: 'Scatter of startup cost (compile + instantiate + first call) against steady execution.',
		config: chart({ title: 'Startup vs throughput', kind: 'scatter', metric: 'steady', xMetric: 'expr', xExpr: 'compile + inst + first', xUnit: 'ms', log: true })
	},
	{
		id: 'tpl-cost-1000',
		type: 'chart',
		label: 'Cost of 1,000 calls',
		description: 'Derived metric: one cold start plus 999 steady calls, ranked.',
		config: chart({ title: 'Estimated cost of 1,000 calls', kind: 'bar', metric: 'expr', expr: 'compile + inst + first + 999 * steady', unit: 'ms', log: true })
	},
	{
		id: 'tpl-spread',
		type: 'chart',
		label: 'Execution spread',
		description: 'Every workload as a dot: how far each runtime is from the fastest.',
		span: 12,
		config: chart({ title: 'Steady execution spread', kind: 'strip', metric: 'steady', normalize: 'best' })
	},
	{
		id: 'tpl-heatmap',
		type: 'chart',
		label: 'Workload heatmap',
		description: 'Workloads × runtimes, shaded by distance from the row’s fastest.',
		span: 12,
		config: chart({ title: 'Steady execution by workload', kind: 'heatmap', per: 'workload', metric: 'steady', limit: 20, height: 360 })
	},
	{
		id: 'tpl-memory',
		type: 'chart',
		label: 'Memory ranking',
		description: 'Peak RSS during the steady run, geometric mean.',
		config: chart({ title: 'Peak memory', kind: 'bar', metric: 'rss' })
	},
	{
		id: 'tpl-compile-columns',
		type: 'chart',
		label: 'Compile time by workload',
		description: 'Grouped columns for the workloads with the widest spread.',
		span: 12,
		config: chart({ title: 'Compilation by workload', kind: 'columns', per: 'workload', metric: 'compile', limit: 10, log: true, height: 300 })
	},
	{
		id: 'tpl-history',
		type: 'chart',
		label: 'Execution history',
		description: 'Weekly execution series per runtime.',
		config: chart({ title: 'Execution over time', source: 'history', kind: 'line', historyKey: 'exec', log: true })
	},
	{
		id: 'tpl-features',
		type: 'chart',
		label: 'Feature pass rate',
		description: 'Share of feature-corpus contracts each runtime passes.',
		config: chart({ title: 'Feature corpus pass rate', source: 'features', kind: 'bar', sort: 'desc' })
	},
	{
		id: 'tpl-feature-heatmap',
		type: 'chart',
		label: 'Feature heatmap',
		description: 'Feature families × runtimes, pass rate per cell.',
		span: 12,
		config: chart({ title: 'Feature families', source: 'features', kind: 'heatmap', height: 420 })
	},
	{
		id: 'tpl-fastest',
		type: 'chart',
		label: 'Fastest runtime (stat)',
		description: 'A single headline number with the runner-up.',
		span: 4,
		config: chart({ title: 'Fastest steady execution', kind: 'stat', metric: 'steady' })
	},
	{
		id: 'tpl-throughput',
		type: 'chart',
		label: 'Work units per second',
		description: 'Derived throughput: units per invocation ÷ steady time.',
		config: chart({ title: 'Throughput', kind: 'bar', metric: 'expr', expr: 'units / (steady / 1000)', unit: '', sort: 'desc', log: true })
	}
];

const b = (type: string, config: BlockConfig = {}, span?: number) => ({ type, config, span });
type Spec = ReturnType<typeof b>;

/** Default layouts. `id`s are assigned when materialized. */
export const DEFAULT_LAYOUTS: Record<string, Spec[]> = {
	home: [b('hero'), b('stats'), b('areas'), b('proposals'), b('methodology', {}, 6), b('recent', {}, 6), b('cta')],
	benchmarks: [b('benchHeader'), b('leaders'), b('matrix'), b('overTime'), b('workloads')],
	history: [b('history')],
	features: [b('features')],
	proposal: [b('proposalOverview'), b('proposalPerformance')],
	bench: [b('benchDetail')],
	compare: [b('compare')],
	dashboard: [
		b('heading', { eyebrow: 'Studio', title: 'My dashboard', text: 'Drag blocks to rearrange, resize from the right edge, and open a block’s settings to change what it shows.', rule: false }),
		b('chart', TEMPLATES[0].config, 6),
		b('chart', TEMPLATES[1].config, 6),
		b('chart', TEMPLATES[2].config, 12),
		b('chart', TEMPLATES[6].config, 6),
		b('chart', TEMPLATES[7].config, 6)
	]
};

let seq = 0;
export const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function defaultLayout(page: string): Layout {
	const key = page.startsWith('dash:') ? 'dashboard' : page;
	const specs = DEFAULT_LAYOUTS[key] ?? [];
	// Stable ids for defaults keep SSR and hydration markup identical.
	return {
		v: 1,
		blocks: specs.map((s, i) => {
			const def = BLOCKS[s.type];
			return { id: `${key}-${i}-${s.type}`, type: s.type, span: s.span ?? def.span, config: { ...def.defaults(), ...structuredClone(s.config) } };
		})
	};
}

/** Drops unknown block types and fills missing config keys, so old or shared layouts stay valid. */
export function sanitize(input: unknown): Layout | null {
	if (!input || typeof input !== 'object' || !Array.isArray((input as Layout).blocks)) return null;
	const seen = new Set<string>();
	const blocks = (input as Layout).blocks
		.filter((x) => x && typeof x === 'object' && typeof x.type === 'string' && BLOCKS[x.type])
		.slice(0, 200)
		.map((x) => {
			const def = BLOCKS[x.type];
			let id = typeof x.id === 'string' && /^[\w-]{1,64}$/.test(x.id) ? x.id : newId();
			if (seen.has(id)) id = newId();
			seen.add(id);
			const span = Math.max(def.minSpan ?? 1, Math.min(12, Math.round(Number(x.span) || def.span)));
			const config = { ...def.defaults(), ...(x.config && typeof x.config === 'object' ? x.config : {}) };
			// Keep config keys well-typed relative to defaults.
			for (const [k, d] of Object.entries(def.defaults())) {
				const v = config[k];
				if (Array.isArray(d) ? !Array.isArray(v) : typeof v !== typeof d) config[k] = d;
			}
			if (Array.isArray(config.configs)) config.configs = (config.configs as unknown[]).filter((id) => CFG.some((c) => c.id === id));
			return { id, type: x.type, span, config, hidden: !!x.hidden };
		});
	return { v: 1, blocks };
}

export const CATEGORIES: BlockDef['category'][] = ['Charts', 'Content', 'Overview', 'Benchmarks', 'History', 'Features', 'Page'];
