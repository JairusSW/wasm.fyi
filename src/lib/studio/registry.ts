// Every block the studio can place, with its settings schema, plus ready-made
// templates and the default layout of each page. Default layouts reproduce the
// site as designed; customizations are stored per page on top of them.
import type { Component } from 'svelte';
import { CFG } from '$lib/data/runtimes';
import { OTM, OTM_KEYS } from '$lib/data/snapshot';
import { EXPR_VARS, CHART_DEFAULTS, KINDS, METRIC_VARS, UNITS, WORKLOAD_GROUPS, type ChartConfig } from './charts/query';
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

const METRIC_OPTIONS: [string, string][] = [
	...METRIC_VARS.map((m) => [m.key, m.label] as [string, string]),
	['expr', 'Custom formula…']
];
const notLine = (c: ChartConfig) => c.kind !== 'line';

export const EXPR_HELP = `Use ${METRIC_VARS.map((m) => m.key).join(', ')}, kb (artifact size) and units (work per call), with + − × ÷ ^ and ${Object.keys(FUNCTIONS).join(', ')}. Missing inputs stay missing.`;

/** The essentials only: what to show, for which runtimes, how to compare. */
const chartFields: Field<ChartConfig>[] = [
	{ key: 'title', label: 'Title', type: 'text' },
	{ key: 'kind', label: 'Chart', type: 'select', options: KINDS.map(([k, label, q]) => [k, `${label} — ${q}`]) },
	{
		key: 'metric',
		label: 'Measure',
		type: 'select',
		options: (c) => [...METRIC_OPTIONS, ...(c.kind === 'bar' || c.kind === 'heatmap' ? ([['features', 'Feature tests passed']] as [string, string][]) : [])],
		when: notLine
	},
	{ key: 'expr', label: 'Formula', type: 'expr', help: EXPR_HELP, when: (c) => notLine(c) && c.metric === 'expr', validate: exprVal },
	{ key: 'unit', label: 'Formula unit', type: 'select', options: UNITS, when: (c) => notLine(c) && (c.metric === 'expr' || (c.kind === 'scatter' && c.xMetric === 'expr')) },
	{ key: 'xMetric', label: 'Against (x axis)', type: 'select', options: METRIC_OPTIONS, when: (c) => c.kind === 'scatter' },
	{ key: 'xExpr', label: 'X formula', type: 'expr', help: EXPR_HELP, when: (c) => c.kind === 'scatter' && c.xMetric === 'expr', validate: exprVal },
	{ key: 'historyKey', label: 'Measure', type: 'select', options: OTM_KEYS.map((k) => [k, OTM[k].l]), when: (c) => c.kind === 'line' },
	{
		key: 'compare',
		label: 'Show as',
		type: 'select',
		options: [
			['absolute', 'Measured values'],
			['baseline', 'Relative to the baseline runtime'],
			['best', 'Relative to the fastest per workload']
		],
		when: (c) => (c.kind === 'bar' || c.kind === 'heatmap') && c.metric !== 'features'
	},
	{ key: 'configs', label: 'Runtimes', type: 'configs', help: 'None selected follows the scope bar.' },
	{ key: 'groups', label: 'Workloads', type: 'chips', options: WORKLOAD_GROUPS.map((g) => [g, g]), help: 'None selected includes every group.', when: (c) => notLine(c) && c.metric !== 'features' },
	{ key: 'log', label: 'Log scale', type: 'toggle', when: (c) => c.kind !== 'heatmap' }
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

/** A few charts that answer the questions people actually ask. */
export const TEMPLATES: Template[] = [
	{
		id: 'tpl-startup-vs-throughput',
		type: 'chart',
		label: 'Startup vs throughput',
		description: 'Cold-start cost against steady speed — the core runtime trade-off.',
		config: chart({ title: 'Startup vs throughput', kind: 'scatter', metric: 'steady', xMetric: 'expr', xExpr: 'compile + inst + first', log: true })
	},
	{
		id: 'tpl-cost-1000',
		type: 'chart',
		label: 'Cost of 1,000 calls',
		description: 'One cold start plus 999 calls: which runtime is cheapest overall.',
		config: chart({ title: 'Cost of 1,000 calls', kind: 'bar', metric: 'expr', expr: 'compile + inst + first + 999 * steady', unit: 'ms', log: true })
	},
	{
		id: 'tpl-heatmap',
		type: 'chart',
		label: 'Wins and losses by workload',
		description: 'Every workload × runtime, shaded by distance from the fastest.',
		span: 12,
		config: chart({ title: 'Steady execution by workload', kind: 'heatmap', metric: 'steady' })
	},
	{
		id: 'tpl-memory',
		type: 'chart',
		label: 'Memory ranking',
		description: 'Peak memory while running, lowest first.',
		config: chart({ title: 'Peak memory', kind: 'bar', metric: 'rss' })
	},
	{
		id: 'tpl-history',
		type: 'chart',
		label: 'Execution over time',
		description: 'Weekly execution time per runtime.',
		config: chart({ title: 'Execution over time', kind: 'line', historyKey: 'exec', log: true })
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
		b('heading', { eyebrow: 'Studio', title: 'My dashboard', text: 'Hover any block and drag ✥ to move it. Customize to resize, collapse or change what a chart shows.', rule: false }),
		b('chart', TEMPLATES[0].config, 6),
		b('chart', TEMPLATES[1].config, 6),
		b('chart', TEMPLATES[2].config, 12),
		b('chart', TEMPLATES[4].config, 12)
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
			if (x.type === 'chart' && !KINDS.some(([k]) => k === config.kind)) config.kind = 'bar';
			if (Array.isArray(config.configs)) config.configs = (config.configs as unknown[]).filter((id) => CFG.some((c) => c.id === id));
			const height = Number(x.height);
			return {
				id,
				type: x.type,
				span,
				config,
				...(Number.isFinite(height) && height >= 40 ? { height: Math.min(4000, Math.round(height)) } : {}),
				...(x.collapsed ? { collapsed: true } : {})
			};
		});
	return { v: 1, blocks };
}

export const CATEGORIES: BlockDef['category'][] = ['Charts', 'Content', 'Overview', 'Benchmarks', 'History', 'Features', 'Page'];
