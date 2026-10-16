import {datasetView} from './api/view.svelte';
// Global UI state. Filters are URL-backed: scope keys (machine, snapshot,
// runtimes) persist across pages; page keys reset to their defaults when a
// URL omits them, so any view can be shared by copying the address bar.
import { CFG, execOf, langOf, type Exec } from './data/runtimes';
import { viewData } from './view-data';
import { comparisonBaseline } from './comparison-baseline';
const defaultConfig=CFG.find(c=>viewData.hosts.m1.configurations[c.id]||viewData.hosts.m2.configurations[c.id])?.id||'A';
import { SNAPS } from './data/snapshot';
import type { CfgId, MachineId, MetricKey, OtMetricKey, OvKey } from './data/types';
import type { Scope } from './model';

export type Drawer =
	| { type: 'cell'; b: string; c: CfgId; m: MetricKey; cf: number; caseLabel?: string; back?: { drawer: Drawer; label: string } }
	| { type: 'feature'; fam: string; c: CfgId; m: 'steady' | 'compile' | 'rss'; peers: CfgId[] }
	| { type: 'support'; fam: string; c: CfgId; channel: 'stable' | 'development'; peers: CfgId[] }
	| { type: 'aggregate'; c: CfgId; group: 'lat' | 'mem' | 'code'; col: number }
	| { type: 'compat'; fam: string; cid: CfgId; kid?: number }
	| { type: 'profile'; rt: string; c?: CfgId };

type Codec<T> = { param: string; def: T; parse: (s: string) => T | undefined; ser: (v: T) => string };

const str = <T extends string>(param: string, def: T, allowed?: readonly T[]): Codec<T> => ({
	param,
	def,
	parse: (s) => (!allowed || allowed.includes(s as T) ? (s as T) : undefined),
	ser: (v) => v
});
const int = (param: string, def: number, lo: number, hi: number): Codec<number> => ({
	param,
	def,
	parse: (s) => {
		const n = Number(s);
		return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
	},
	ser: String
});
const num = (param: string, def: number, lo: number, hi: number): Codec<number> => ({
	param,
	def,
	parse: (s) => {
		const n = Number(s);
		return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
	},
	ser: String
});
const bool = (param: string): Codec<boolean> => ({
	param,
	def: false,
	parse: (s) => s === '1',
	ser: (v) => (v ? '1' : '0')
});
const nullable = (param: string): Codec<string | null> => ({
	param,
	def: null,
	parse: (s) => s || null,
	ser: (v) => v ?? ''
});

const configIds = () => CFG.map((c) => c.id);
const isCfg = (s: string): s is CfgId => (configIds() as string[]).includes(s) || /^engine:[a-z0-9][a-z0-9._-]{0,127}$/.test(s);

/** Hidden runtimes, serialized as the list of *shown* config ids so the default is empty. */
const hideCodec: Codec<Partial<Record<CfgId, boolean>>> = {
	param: 'rt',
	def: {},
	parse: (s) => {
		const on = s.split(',').filter(isCfg);
		if (!on.length) return undefined;
		return Object.fromEntries([...new Set([...configIds(), ...on])].map((id) => [id, !on.includes(id)]));
	},
	ser: (v) => [...new Set([...configIds(),...Object.keys(v).filter(isCfg)])].filter((id) => !v[id]).join(',')
};
const sortCodec: Codec<{ id: CfgId; dir: 1 | -1 } | null> = {
	param: 'sort',
	def: null,
	parse: (s) => {
		const desc = s.startsWith('-');
		const id = desc ? s.slice(1) : s;
		return isCfg(id) ? { id, dir: desc ? -1 : 1 } : undefined;
	},
	ser: (v) => (v ? (v.dir < 0 ? '-' : '') + v.id : '')
};
const memSelCodec: Codec<CfgId[]> = {
	param: 'cfgs',
	def: ['A', 'C', 'F'],
	parse: (s) => s.split(',').filter(isCfg).slice(-3),
	ser: (v) => v.join(',')
};

const OT_KEYS = ['exec', 'callTotal', 'hostWasm', 'wasmHostLoop', 'compile', 'inst', 'mem', 'code', 'cov'] as const;
const METRICS = ['compile', 'rssCompile', 'inst', 'rssInst', 'first', 'steady', 'rss', 'code'] as const;

/** Each URL-backed field: its codec and the routes it belongs to (`*` = scope, every route). */
const FIELDS = {
	cohortMode: { codec: str('cohort', 'shared', ['shared', 'per-engine'] as const), routes: '*' },
	average: { codec: str('avg', 'geo', ['geo', 'mean'] as const), routes: '*' },
	deltaFormat: { codec: str('delta', 'percent', ['factor', 'percent'] as const), routes: '*' },
	machine: { codec: str<MachineId>('m', 'm1', ['m1', 'm2', 'm3']), routes: '*' },
	snap: { codec: str('snap', 's1', ['s1', 's2']), routes: '*' },
	hide: { codec: hideCodec, routes: '*' },
	exec: { codec: str<Exec>('exec', 'compiler', ['all', 'compiler', 'interpreter']), routes: '*' },
	lang: { codec: str('lang', 'all'), routes: '*' },
	group: { codec: str<OvKey>('view', 'lat', ['lat', 'calls', 'mem', 'code', 'cov']), routes: ['/benchmarks'] },
	metric: { codec: str<MetricKey>('metric', 'steady', METRICS), routes: ['/benchmarks'] },
	tag: { codec: nullable('tag'), routes: ['/benchmarks'] },
	q: { codec: str('q', ''), routes: ['/benchmarks'] },
	sortBy: { codec: sortCodec, routes: ['/benchmarks'] },
	otMetric: { codec: str<OtMetricKey>('ot', 'exec', OT_KEYS), routes: ['/benchmarks', '/history'] },
	histMode: { codec: str('mode', 'ratio', ['ratio', 'change'] as const), routes: ['/history'] },
	histFrom: { codec: int('from', 0, 0, 10000), routes: ['/history', '/benchmarks', '/bench/[...id]'] },
	histTo: { codec: int('to', Math.max(0,SNAPS.length-1), 0, 10000), routes: ['/history', '/benchmarks', '/bench/[...id]'] },
	histCfg: { codec: str<CfgId>('cfg', defaultConfig, configIds()), routes: ['/history'] },
	compatView: { codec: str('view', 'support', ['support', 'tests', 'perf'] as const), routes: ['/features'] },
	perfMetric: { codec: str('pm', 'exec', ['exec', 'compile', 'mem'] as const), routes: ['/features'] },
	bdTab: {
		codec: str('tab', 'latency', ['latency', 'memory', 'code', 'history', 'run'] as const),
		routes: ['/bench/[...id]']
	},
	memSel: { codec: memSelCodec, routes: ['/bench/[...id]'] },
	memMetric: { codec: str('mm', 'rss', ['rss', 'pss', 'linear'] as const), routes: ['/bench/[...id]'] },
	memAligned: { codec: bool('aligned'), routes: ['/bench/[...id]'] },
	kernel: { codec: str('kernel', 'arithmetic/1'), routes: ['/[proposal=proposal]'] },
	xWork: { codec: str('work', 'wago/tiny/add', ['wago/tiny/add', 'wago/zlib/inflate']), routes: ['/compare'] },
	xReuse: { codec: str('reuse', 'single', ['single', 'shared', 'cached'] as const), routes: ['/compare'] },
	xLog: { codec: num('n', 2, 0, 6), routes: ['/compare'] }
} satisfies Record<string, { codec: Codec<any>; routes: '*' | string[] }>;

type Fields = typeof FIELDS;
type FieldKey = keyof Fields;

class UiState {
	// scope
	deltaFormat = $state<'factor' | 'percent'>('percent');
	machine = $state<MachineId>('m1');
	snap = $state<'s1' | 's2'>('s1');
	hide = $state<Partial<Record<CfgId, boolean>>>({});
	/** Execution-model filter; combined with the per-runtime `hide` choices in `scope.hide`. */
	exec = $state<Exec>('compiler');
	/** Implementation-language filter ('all' or a langOf group); combined like `exec`. */
	lang = $state('all');
	shownHide = $derived({
		...this.hide,
		...Object.fromEntries(CFG.filter((c) => (this.exec !== 'all' && execOf(c) !== this.exec) || (this.lang !== 'all' && langOf(c) !== this.lang)).map((c) => [c.id, true]))
	});
	baseline = $derived(comparisonBaseline(defaultConfig, CFG.filter(c => viewData.hosts[this.machine].configurations[c.id]).map(c => c.id)));
	// Every workload counts equally in averages; no per-corpus weighting.
	weighting = $state<'corpus' | 'workload'>('workload');
	cohortMode = $state<'shared' | 'per-engine'>('shared');
	/** How workload results combine into one number: geometric mean (default) or plain mean. */
	average = $state<'geo' | 'mean'>('geo');
	adv = $state(false);
	theme = $state<'dark' | 'light'>('dark');
	drawer = $state<Drawer | null>(null);

	// benchmarks
	group = $state<OvKey>('lat');
	metric = $state<MetricKey>('steady');
	tag = $state<string | null>(null);
	q = $state('');
	sortBy = $state<{ id: CfgId; dir: 1 | -1 } | null>(null);
	collapsed = $state<Record<string, boolean>>({});
	expanded = $state<Record<string, boolean>>({});
	otMetric = $state<OtMetricKey>('exec');

	// history
	histMode = $state<'ratio' | 'change'>('ratio');
	histFrom = $state(0);
	histTo = $state(SNAPS.length-1);
	histCfg = $state<CfgId>(defaultConfig);

	// features
	compatView = $state<'support' | 'tests' | 'perf'>('support');
	perfMetric = $state<'exec' | 'compile' | 'mem'>('exec');
	compatOpen = $state<Record<string, boolean>>({ simd: true, threads: true });

	// benchmark detail
	bdTab = $state<'latency' | 'memory' | 'code' | 'history' | 'run'>('latency');
	memSel = $state<CfgId[]>(['A', 'C', 'F']);
	memMetric = $state<'rss' | 'pss' | 'linear'>('rss');
	memAligned = $state(false);

	// proposals
	kernel = $state('arithmetic/1');

	// compare
	xWork = $state('wago/tiny/add');
	xReuse = $state<'single' | 'shared' | 'cached'>('single');
	xLog = $state(2);

	scope: Scope = $derived({ machine: this.machine, baseline: this.baseline, weighting: this.weighting, cohortMode: this.cohortMode, average: this.average, hide: this.shownHide, snapshot:this.snap, exec: this.exec });

	/** Applies URL params for `routeId`. Scope keys missing from the URL keep their current value. */
	loadFromUrl(url: URL, routeId: string | null) {
		const sp = url.searchParams;
		for (const [key, f] of Object.entries(FIELDS) as [FieldKey, Fields[FieldKey]][]) {
			const global = f.routes === '*';
			if (!global && !(routeId && (f.routes as string[]).includes(routeId))) continue;
			const raw = sp.get(f.codec.param);
			const parsed = raw == null ? undefined : (f.codec.parse as (s: string) => unknown)(raw);
			if (parsed !== undefined) (this as any)[key] = parsed;
			else if (!global) (this as any)[key] = structuredClone(f.codec.def);
			else if (raw != null) (this as any)[key] = structuredClone(f.codec.def);
		}
		if (['roundTrip','hostWasm','wasmHostLoop'].includes(sp.get('ot')||'')) this.otMetric = 'callTotal';
		if (this.histFrom >= this.histTo) this.histFrom = Math.max(0, this.histTo - 1);
	}

	/** Query string representing current state for `routeId`, omitting defaults. */
	toSearch(routeId: string | null): string {
		const sp = new URLSearchParams();
        if(datasetView.revision)sp.set('revision',datasetView.revision);
		for (const [key, f] of Object.entries(FIELDS) as [FieldKey, Fields[FieldKey]][]) {
			if (f.routes !== '*' && !(routeId && (f.routes as string[]).includes(routeId))) continue;
			const v = (this as any)[key];
			const s = (f.codec.ser as (v: unknown) => string)(v);
			const d = (f.codec.ser as (v: unknown) => string)(f.codec.def);
			if(key==='machine'){sp.set(f.codec.param,s);continue;}
			if (s !== d && s !== '') sp.set(f.codec.param, s);
		}
		const out = sp.toString();
		return out ? '?' + out : '';
	}

	/** Open a runtime profile for one backend; without `c` the runtime's first backend on this machine. */
	openProfile(rt: string, c?: CfgId) {
		this.drawer = { type: 'profile', rt, c };
	}
}

export const ui = new UiState();
