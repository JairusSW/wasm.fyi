export type CfgId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S';
export type MachineId = 'm1' | 'm2';
export type ProposalId = 'simd' | 'gc' | 'memory64' | 'threads';
export type SupportCode = 'y' | 'f' | 'p' | 'n' | '?' | '-';
export type Status = 'ok' | 'unsupported' | 'disabled' | 'failed' | 'crashed' | 'timeout' | 'nm' | 'na' | 'unavail';
export type MetricKey = 'compile' | 'rssCompile' | 'inst' | 'rssInst' | 'first' | 'steady' | 'rss' | 'code';
export type OvKey = 'lat' | 'calls' | 'mem' | 'code' | 'cov';
export type OtMetricKey = 'exec' | 'wasmHost' | 'hostWasm' | 'roundTrip' | 'compile' | 'inst' | 'mem' | 'code' | 'cov';

/** A benchmarked runtime configuration: one runtime at one version with one backend. */
export interface Cfg {
	id: CfgId;
	rt: string;
	ver: string;
	be: string;
	kind: string;
	col: string;
	/** Alternate backend — drawn with a hollow swatch and dashed lines. */
	hollow: boolean;
	interp?: boolean;
}

export interface Runtime {
	id: string;
	name: string;
	lang: string;
	exec: string[];
	tiers: string;
	arch: string[];
	wasi: string;
	cm: SupportCode;
	repo: string;
	lic: string;
	rel: string;
	size: string;
	embed: string[];
	cfg?: CfgId[];
	/** Index into a feature's browser list when this engine ships in a browser. */
	engine?: number;
	notes: string[];
}

export interface Machine {
	l: string;
	os: string;
	/** Per-config multiplier relative to the reference machine. */
	f: Partial<Record<CfgId, number>>;
	/** Configs unavailable on this machine, with the reason. */
	off: Partial<Record<CfgId, string>>;
}

export interface FeatureRow {
	g: string;
	id: string;
	name: string;
	phase: string;
	/** First version enabled by default per browser, or a support code. */
	b: string[];
	/** One support code per standalone runtime, in `SA` order. */
	r: string;
	page?: ProposalId;
	/** Upstream proposal repository or overview. */
	url?: string;
}

export interface Proposal {
	title: string;
	long: string;
	q: string;
	repo: string;
	ver: string;
	hist: [string, string][];
	tools: [string, SupportCode, string][];
}

export interface CompatFamily {
	id: string;
	name: string;
	total: number;
	page?: ProposalId;
	kids: [string, number][];
	/**
	 * Per-config result spec `availability[:passFraction[:cN|sN]]`, in `CFG` order.
	 * availability: d default · f flag · u unavailable · ? unknown · n not run.
	 */
	r: string[];
}

export interface CompatSection {
	sec: string;
	unit: string;
	suite: string;
	fams: CompatFamily[];
}

/** [ratio vs reference config, 95% CI half-width] */
export type RatioCi = [number, number];

export interface OvGroup {
	label: string;
	cols: string[];
	metrics: MetricKey[];
}

export interface OtMetric {
	key: OtMetricKey;
	l: string;
	g: OvKey;
	c: number;
	u: string;
	k: number;
}

export interface Snap {
	i: number;
	date: string;
	short: string;
}

export interface SnapEvent {
	i: number;
	kind: 'release' | 'corpus' | 'harness' | 'revision';
	label: string;
}

export interface BenchItem {
	evidenceScope?: string;
	abi?:string;reset?:string;oracle?:unknown;imports?:number;unitsPerInvocation?:number;workUnit?:string;
	baseline?: boolean;
	id: string;
	artifactSha256?: string;
	tags: string[];
	kb: number;
	ms: number | null;
	cases?: [string, number][];
	purpose?: string;
	input?: string;
	src?: string;
}

export interface BenchGroup {
	g: string;
	total: number;
	items: BenchItem[];
}

export interface Bench extends BenchItem {
	group: string;
}
