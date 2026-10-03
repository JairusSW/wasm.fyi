// Whole-page arrangements for common questions. Applying one is a single undo step.
import { CHART_DEFAULTS, type ChartConfig } from './charts/query';
import { BLOCKS, TEMPLATES, defaultLayout, newId } from './registry';
import type { BlockConfig, Layout } from './types';

const chart = (patch: Partial<ChartConfig>): BlockConfig => ({ ...structuredClone(CHART_DEFAULTS), ...patch });
const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!;
type Item = [type: string, span?: number, config?: BlockConfig];
const build = (items: Item[]): Layout => ({
	v: 1,
	blocks: items.map(([type, span, config]) => ({
		id: newId(),
		type,
		span: span ?? BLOCKS[type].span,
		config: { ...BLOCKS[type].defaults(), ...structuredClone(config ?? {}) }
	}))
});
const fromTpl = (id: string, span?: number): Item => ['chart', span ?? tpl(id).span ?? 6, tpl(id).config];

export interface Preset {
	id: string;
	label: string;
	description: string;
	/** Pages it applies to; omitted = any page. */
	pages?: string[];
	build: (page: string) => Layout;
}

const stat = (title: string, metric: string): Item => ['chart', 4, chart({ title, kind: 'stat', metric })];

export const PRESETS: Preset[] = [
	{
		id: 'default',
		label: 'Default layout',
		description: 'The page as designed.',
		build: (page) => {
			const l = defaultLayout(page);
			return { v: 1, blocks: l.blocks.map((b) => ({ ...b, id: newId() })) };
		}
	},
	{
		id: 'startup',
		label: 'Startup focus',
		description: 'Cold-start cost first: compile, instantiate, first call and the cost of a single invocation.',
		pages: ['benchmarks', 'home'],
		build: () =>
			build([
				['benchHeader'],
				stat('Fastest compilation', 'compile'),
				stat('Fastest instantiation', 'inst'),
				stat('Fastest first call', 'first'),
				['chart', 6, chart({ title: 'Cost of one cold invocation', kind: 'bar', metric: 'expr', expr: 'compile + inst + first', unit: 'ms', log: true })],
				fromTpl('tpl-startup-vs-throughput', 6),
				fromTpl('tpl-compile-columns', 12),
				['workloads']
			])
	},
	{
		id: 'throughput',
		label: 'Throughput focus',
		description: 'Steady-state execution: spread across workloads and the per-workload heatmap.',
		pages: ['benchmarks', 'home'],
		build: () =>
			build([['benchHeader'], ['leaders'], fromTpl('tpl-spread', 12), fromTpl('tpl-throughput', 6), fromTpl('tpl-cost-1000', 6), fromTpl('tpl-heatmap', 12), ['workloads']])
	},
	{
		id: 'memory',
		label: 'Memory focus',
		description: 'Peak RSS ranking, memory vs speed, and memory per workload.',
		pages: ['benchmarks', 'home'],
		build: () =>
			build([
				['benchHeader'],
				fromTpl('tpl-memory', 6),
				['chart', 6, chart({ title: 'Memory vs speed', kind: 'scatter', metric: 'rss', xMetric: 'steady', log: true })],
				['chart', 12, chart({ title: 'Peak RSS by workload', kind: 'heatmap', per: 'workload', metric: 'rss', limit: 20, height: 360 })],
				['matrix'],
				['workloads']
			])
	},
	{
		id: 'compact',
		label: 'Compact',
		description: 'Just the leaders and the per-workload table.',
		pages: ['benchmarks'],
		build: () => build([['benchHeader'], ['leaders'], ['workloads']])
	},
	{
		id: 'data-home',
		label: 'Data-first home',
		description: 'Headline numbers and charts above the fold.',
		pages: ['home'],
		build: () =>
			build([
				['hero', 12, { board: false }],
				stat('Fastest compilation', 'compile'),
				stat('Fastest instantiation', 'inst'),
				stat('Fastest steady execution', 'steady'),
				fromTpl('tpl-startup-vs-throughput', 6),
				fromTpl('tpl-features', 6),
				['stats'],
				['proposals'],
				['methodology', 6],
				['recent', 6]
			])
	},
	{
		id: 'analyst',
		label: 'Analyst wall',
		description: 'Every chart template on one page.',
		build: (page) =>
			build([['heading', 12, { eyebrow: 'Analysis', title: 'Every angle', text: 'All chart templates. Open any chart’s settings to change its metric, filters or type.', rule: false }], ...TEMPLATES.map((t) => fromTpl(t.id)), ...(page === 'benchmarks' ? ([['workloads']] as Item[]) : [])])
	}
];
