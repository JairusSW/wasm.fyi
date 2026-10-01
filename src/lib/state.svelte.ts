// Global UI state. Filters are URL-backed: scope keys (machine, snapshot,
// runtimes) persist across pages; page keys reset to their defaults when a
// URL omits them, so any view can be shared by copying the address bar.
import { CFG } from './data/runtimes';
import { SNAPS } from './data/snapshot';
import type { CfgId, MachineId, MetricKey, OtMetricKey, OvKey } from './data/types';
import type { Scope } from './model';

export type Drawer =
	| { type: 'cell'; b: string; c: CfgId; m: MetricKey; cf: number; caseLabel?: string }
	| { type: 'compat'; fam: string; cid: CfgId; kid?: number }
	| { type: 'profile'; rt: string };

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

const CFG_IDS = CFG.map((c) => c.id);
const isCfg = (s: string): s is CfgId => (CFG_IDS as string[]).includes(s);

/** Hidden runtimes, serialized as the list of *shown* config ids so the default is empty. */
const hideCodec: Codec<Partial<Record<CfgId, boolean>>> = {
	param: 'rt',
	def: {},
	parse: (s) => {
		const on = s.split(',').filter(isCfg);
		if (!on.length) return undefined;
		return Object.fromEntries(CFG_IDS.map((id) => [id, !on.includes(id)]));
	},
	ser: (v) => CFG_IDS.filter((id) => !v[id]).join(',')
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

const OT_KEYS = ['exec', 'compile', 'inst', 'mem', 'code', 'cov'] as const;
const METRICS = ['compile', 'inst', 'first', 'steady', 'rss', 'code'] as const;

/** Each URL-backed field: its codec and the routes it belongs to (`*` = scope, every route). */
const FIELDS = {
	machine: { codec: str<MachineId>('m', 'm1', ['m1', 'm2']), routes: '*' },
	snap: { codec: str('snap', 's1', ['s1', 's2']), routes: '*' },
	hide: { codec: hideCodec, routes: '*' },
	group: { codec: str<OvKey>('view', 'lat', ['lat', 'mem', 'code', 'cov']), routes: ['/benchmarks'] },
	metric: { codec: str<MetricKey>('metric', 'steady', METRICS), routes: ['/benchmarks'] },
	tag: { codec: nullable('tag'), routes: ['/benchmarks'] },
	q: { codec: str('q', ''), routes: ['/benchmarks'] },
	sortBy: { codec: sortCodec, routes: ['/benchmarks'] },
	otMetric: { codec: str<OtMetricKey>('ot', 'exec', OT_KEYS), routes: ['/benchmarks', '/history'] },
	histMode: { codec: str('mode', 'ratio', ['ratio', 'change'] as const), routes: ['/history'] },
	histFrom: { codec: int('from', 0, 0, SNAPS.length-2), routes: ['/history'] },
	histTo: { codec: int('to', SNAPS.length-1, 1, SNAPS.length-1), routes: ['/history'] },
	histCfg: { codec: str<CfgId>('cfg', 'A', CFG_IDS), routes: ['/history'] },
	compatView: { codec: str('view', 'support', ['support', 'tests', 'perf'] as const), routes: ['/features'] },
	perfMetric: { codec: str('pm', 'exec', ['exec', 'compile', 'mem'] as const), routes: ['/features'] },
	bdTab: {
		codec: str('tab', 'latency', ['latency', 'memory', 'code', 'history', 'run'] as const),
		routes: ['/bench/[...id]']
	},
	memSel: { codec: memSelCodec, routes: ['/bench/[...id]'] },
	memMetric: { codec: str('mm', 'rss', ['rss', 'pss', 'linear'] as const), routes: ['/bench/[...id]'] },
	memAligned: { codec: bool('aligned'), routes: ['/bench/[...id]'] },
	kernel: { codec: str('kernel', 'dot-f32'), routes: ['/[proposal=proposal]'] },
	xWork: { codec: str('work', 'markdown-parse', ['markdown-parse', 'js-interp/richards']), routes: ['/compare'] },
	xReuse: { codec: str('reuse', 'single', ['single', 'shared', 'cached'] as const), routes: ['/compare'] },
	xLog: { codec: num('n', 2, 0, 6), routes: ['/compare'] }
} satisfies Record<string, { codec: Codec<any>; routes: '*' | string[] }>;

type Fields = typeof FIELDS;
type FieldKey = keyof Fields;

class UiState {
	// scope
	machine = $state<MachineId>('m1');
	snap = $state<'s1' | 's2'>('s1');
	hide = $state<Partial<Record<CfgId, boolean>>>({});
	baseline = $state<CfgId>('A');
	weighting = $state<'corpus' | 'workload'>('corpus');
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
	histCfg = $state<CfgId>('A');
	histPick = $state<'from' | 'to'>('to');

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
	kernel = $state('dot-f32');

	// compare
	xWork = $state('markdown-parse');
	xReuse = $state<'single' | 'shared' | 'cached'>('single');
	xLog = $state(2);

	scope: Scope = $derived({ machine: this.machine, baseline: this.baseline, weighting: this.weighting, hide: this.hide, snapshot:this.snap });

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
		if (this.histFrom >= this.histTo) this.histFrom = Math.max(0, this.histTo - 1);
	}

	/** Query string representing current state for `routeId`, omitting defaults. */
	toSearch(routeId: string | null): string {
		const sp = new URLSearchParams();
		for (const [key, f] of Object.entries(FIELDS) as [FieldKey, Fields[FieldKey]][]) {
			if (f.routes !== '*' && !(routeId && (f.routes as string[]).includes(routeId))) continue;
			const v = (this as any)[key];
			const s = (f.codec.ser as (v: unknown) => string)(v);
			const d = (f.codec.ser as (v: unknown) => string)(f.codec.def);
			if (s !== d && s !== '') sp.set(f.codec.param, s);
		}
		const out = sp.toString();
		return out ? '?' + out : '';
	}

	openProfile(rt: string) {
		this.drawer = { type: 'profile', rt };
	}
}

export const ui = new UiState();
