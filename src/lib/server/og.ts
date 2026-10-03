// Share-image rendering. Cards are built from the same measured view and model
// functions as the pages, laid out with satori and rasterized with resvg at
// build time (the og/[slug].png endpoint is prerendered).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { FEATS, PROPS } from '$lib/data/features';
import { CFG, FEATURE_CFG, FEATURE_ENGINES } from '$lib/data/runtimes';
import { ALLB } from '$lib/data/snapshot';
import type { Cfg, ProposalId } from '$lib/data/types';
import { fmtU, shortCount, workloadName } from '$lib/format';
import { PROPOSAL_IDS } from '$lib/links';
import { absOf, benchVal, compatCell, disp, featureContracts, isVisible, ratio, TOTAL_WORKLOADS, type Scope } from '$lib/model';
import { OG_HEIGHT, OG_WIDTH, hasOwnImage, workloadSlug } from '$lib/og';
import { viewData } from '$lib/view-data';

// Dark theme tokens from app.css (runtime colors converted from oklch).
const C = {
	bg: '#0d0e10',
	bg2: '#131518',
	line: '#23272c',
	line2: '#31363c',
	fg: '#e4e6e9',
	fg2: '#a6acb4',
	fg3: '#7d848d',
	warn: '#f59d4f'
};
const RUNTIME: Record<string, string> = { wasmtime: '#6aa7f4', wasmer: '#ebae51', wazero: '#b98cea', v8: '#4dcbc4', wago: '#e881b4' };
const runtimeColor = (rt: string) => RUNTIME[rt] ?? '#6b727b';

const scope: Scope = { machine: 'm1', baseline: 'A', weighting: 'corpus', hide: {}, snapshot: 's1' };

interface BarRow {
	label: string;
	sub: string;
	value: string;
	frac: number;
	color: string;
	hollow?: boolean;
}
type Panel = { kind: 'bars'; title: string; note: string; rows: BarRow[] } | { kind: 'stats'; items: [string, string][] };
interface Card {
	path: string;
	eyebrow: string;
	title: string;
	subtitle: string;
	panel?: Panel;
}

// ── Card content ─────────────────────────────────────────────────────────

/** Proportional bar lengths; a log scale only when the spread exceeds 10×. */
function fracs(values: number[]): { f: number[]; log: boolean } {
	const lo = Math.min(...values);
	const hi = Math.max(...values);
	if (hi / lo <= 10) return { f: values.map((v) => Math.max(0.04, v / hi)), log: false };
	return { f: values.map((v) => 0.08 + (0.92 * Math.log(v / lo)) / Math.log(hi / lo)), log: true };
}

function bars(title: string, note: string, items: { c: Cfg; v: number; text: string }[]): Panel | undefined {
	if (!items.length) return undefined;
	const { f, log } = fracs(items.map((x) => x.v));
	// Name the backend only when a runtime appears more than once.
	const dup = (c: Cfg) => items.filter((x) => x.c.rt === c.rt).length > 1;
	return {
		kind: 'bars',
		title,
		note: note + (log ? ' · log scale' : ''),
		rows: items.map((x, i) => ({ label: x.c.rt, sub: dup(x.c) ? x.c.be : '', value: x.text, frac: f[i], color: runtimeColor(x.c.rt), hollow: x.c.hollow }))
	};
}

/** Top runtimes on an aggregate column, the same ranking the pages show. */
function leaders(col: number, title: string, n = 5): Panel | undefined {
	const list = CFG.filter((c) => isVisible(scope, c))
		.map((c) => ({ c, r: ratio(scope, 'lat', c.id, col), a: absOf(scope, 'lat', c.id, col) }))
		.filter((x) => x.r && x.a)
		.sort((a, b) => a.r!.r - b.r!.r)
		.slice(0, n);
	const count = list[0]?.r?.count;
	return bars(title, count ? `geomean of ${count} workloads` : 'geometric mean', list.map((x) => ({ c: x.c, v: x.a!.v, text: disp(scope, 'lat', x.c.id, col)!.t })));
}

function coldStart(): Panel | undefined {
	const list = CFG.filter((c) => isVisible(scope, c))
		.map((c) => {
			const parts = [0, 1, 2].map((i) => absOf(scope, 'lat', c.id, i)?.v);
			return { c, v: parts.every((x) => x != null) ? parts.reduce((a, b) => a! + b!, 0)! : null };
		})
		.filter((x): x is { c: Cfg; v: number } => x.v != null && x.v > 0)
		.sort((a, b) => a.v - b.v)
		.slice(0, 5);
	return bars('Cheapest cold call', 'compile + instantiate + first call', list.map((x) => ({ ...x, text: fmtU(x.v, 'ms') })));
}

function workloadBars(id: string): Panel | undefined {
	const b = ALLB.find((x) => x.id === id)!;
	const list = CFG.filter((c) => isVisible(scope, c))
		.map((c) => ({ c, r: benchVal(scope, b, c.id, 'steady') }))
		.flatMap((x) => (x.r.st === 'ok' ? [{ c: x.c, v: x.r.v }] : []))
		.sort((a, b) => a.v - b.v)
		.slice(0, 6);
	return bars('Steady execution', 'median per invocation', list.map((x) => ({ ...x, text: fmtU(x.v, 'ms') })));
}

function featureBars(family: string): Panel | undefined {
	const list = FEATURE_CFG.map((c) => ({ c, r: compatCell(family, c.id, scope) }))
		.filter((x) => x.r.run && x.r.total)
		.map((x) => ({ c: x.c, pass: x.r.pass, total: x.r.total }))
		.sort((a, b) => b.pass / b.total - a.pass / a.total)
		.slice(0, 6);
	if (!list.length) return undefined;
	return {
		kind: 'bars',
		title: 'Feature tests passed',
		note: `${list[0].total} corpus tests`,
		rows: list.map((x) => ({ label: x.c.rt, sub: list.filter((y) => y.c.rt === x.c.rt).length > 1 ? x.c.be : '', value: `${x.pass}/${x.total}`, frac: Math.max(0.04, x.pass / x.total), color: runtimeColor(x.c.rt), hollow: x.c.hollow }))
	};
}

function cardFor(slug: string): Card {
	if (PROPOSAL_IDS.includes(slug as ProposalId)) {
		const p = PROPS[slug as ProposalId];
		const f = FEATS.find((x) => x.id === slug);
		return { path: `/${slug}`, eyebrow: f?.phase ?? 'Proposal', title: p.title, subtitle: p.q, panel: featureBars(slug) };
	}
	if (slug.startsWith('w-')) {
		const b = ALLB.find((x) => hasOwnImage(x) && workloadSlug(x.id) === slug);
		if (b) return { path: '/bench', eyebrow: b.group, title: workloadName(b.id), subtitle: b.purpose ?? '', panel: workloadBars(b.id) };
	}
	const featureTests = FEATS.reduce((n, f) => n + featureContracts(f.id).length, 0);
	switch (slug) {
		case 'benchmarks':
			return { path: '/benchmarks', eyebrow: 'Benchmarks', title: 'Which runtime, and why?', subtitle: 'Compilation, instantiation, execution, memory and machine code across real programs.', panel: leaders(0, 'Fastest compilation') };
		case 'history':
			return {
				path: '/history',
				eyebrow: 'History',
				title: 'Every metric, over time.',
				subtitle: 'Source revisions, recorded gaps and fixed comparison baselines — never interpolated.',
				panel: { kind: 'stats', items: [[String(viewData.history.m1.points.length), 'weekly points'], [String(TOTAL_WORKLOADS), 'measured contracts'], [shortCount(viewData.statistics.timingSamples), 'timing samples'], [String(Object.keys(viewData.reports).length), 'pinned reports']] }
			};
		case 'features':
			return {
				path: '/features',
				eyebrow: 'Features',
				title: 'Beyond the checkbox.',
				subtitle: 'Released engine compatibility, official suite results and feature performance.',
				panel: { kind: 'stats', items: [[String(FEATS.length), 'feature families'], [String(FEATURE_ENGINES.length), 'engines'], [shortCount(featureTests), 'corpus tests'], [String(Object.keys(viewData.hosts).length), 'machines']] }
			};
		case 'compare':
			return { path: '/compare', eyebrow: 'Model', title: 'Startup vs throughput', subtitle: 'When does a slow-starting fast runtime win? Total cost as invocations grow.', panel: coldStart() };
		default:
			return { path: '', eyebrow: '', title: 'The reference for\nWebAssembly runtimes.', subtitle: 'Independent benchmarks, feature support and proposal performance. Every number links to its run.', panel: leaders(3, 'Fastest execution') };
	}
}

// ── Layout ───────────────────────────────────────────────────────────────

type El = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): El => ({
	type,
	props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c != null && c !== false) }
});
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function panelEl(p: Panel): El {
	if (p.kind === 'stats')
		return h(
			'div',
			{ width: 470, flexWrap: 'wrap', border: `1px solid ${C.line}`, background: C.bg2 },
			p.items.map(([v, l], i) =>
				h(
					'div',
					{ width: 234, flexDirection: 'column', padding: '28px 28px', borderRight: i % 2 === 0 ? `1px solid ${C.line}` : 'none', borderBottom: i < 2 ? `1px solid ${C.line}` : 'none' },
					h('div', { fontFamily: 'Plex Mono', fontSize: 54, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1 }, v),
					h('div', { fontSize: 20, color: C.fg3, marginTop: 10 }, l)
				)
			)
		);
	return h(
		'div',
		{ width: 540, flexDirection: 'column', border: `1px solid ${C.line}`, background: C.bg2 },
		h(
			'div',
			{ justifyContent: 'space-between', alignItems: 'baseline', padding: '18px 24px', borderBottom: `1px solid ${C.line}` },
			h('div', { fontSize: 22, fontWeight: 600 }, p.title),
			h('div', { fontFamily: 'Plex Mono', fontSize: 15, color: C.fg3 }, p.note)
		),
		h(
			'div',
			{ flexDirection: 'column', padding: '16px 24px 20px', gap: 14 },
			p.rows.map((r, i) =>
				h(
					'div',
					{ alignItems: 'center', gap: 12 },
					h('div', { width: 18, fontFamily: 'Plex Mono', fontSize: 15, color: C.fg3 }, String(i + 1)),
					h('div', { width: 12, height: 12, border: `2px solid ${r.color}`, background: r.hollow ? 'transparent' : r.color }),
					h(
						'div',
						{ width: 196, alignItems: 'baseline', gap: 8, overflow: 'hidden', whiteSpace: 'nowrap' },
						h('div', { fontSize: 21, fontWeight: 500 }, clip(r.label, 14)),
						r.sub ? h('div', { fontSize: 15, color: C.fg3 }, clip(r.sub, 12)) : null
					),
					h('div', { flex: 1, height: 12, background: C.line, }, h('div', { width: `${Math.round(r.frac * 100)}%`, height: 12, background: r.color })),
					h('div', { width: 100, justifyContent: 'flex-end', fontFamily: 'Plex Mono', fontSize: 19 }, r.value)
				)
			)
		)
	);
}

function cardEl(card: Card, meta: { date: string; host: string }): El {
	const wide = !card.panel;
	const t = card.title;
	const longest = Math.max(...t.split('\n').map((l) => l.length));
	// Explicit lines never wrap: size them to fit the column (~0.56em per glyph).
	const column = wide ? 1072 : 1072 - 52 - 540;
	const size = t.includes('\n') ? Math.min(66, Math.floor(column / (longest * 0.56))) : wide ? (t.length > 40 ? 68 : 84) : t.length > 34 ? 46 : t.length > 22 ? 56 : 66;
	return h(
		'div',
		{ width: OG_WIDTH, height: OG_HEIGHT, flexDirection: 'column', background: C.bg, color: C.fg, fontFamily: 'Plex Sans', position: 'relative' },
		// Header
		h(
			'div',
			{ alignItems: 'center', justifyContent: 'space-between', padding: '40px 64px 0' },
			h(
				'div',
				{ alignItems: 'baseline', gap: 14 },
				h('div', { fontFamily: 'Plex Mono', fontSize: 30, fontWeight: 600 }, 'wasm.fyi'),
				card.path ? h('div', { fontFamily: 'Plex Mono', fontSize: 22, color: C.fg3 }, card.path) : null
			),
			h('div', { fontFamily: 'Plex Mono', fontSize: 15, letterSpacing: '0.06em', color: C.warn, border: `1.5px solid ${C.warn}`, padding: '4px 10px' }, 'MEASURED DATA')
		),
		// Body
		h(
			'div',
			{ flex: 1, alignItems: 'center', gap: 52, padding: '0 64px' },
			h(
				'div',
				{ flex: 1, flexDirection: 'column', gap: 18 },
				card.eyebrow ? h('div', { fontFamily: 'Plex Mono', fontSize: 18, color: C.fg3, textTransform: 'uppercase', letterSpacing: '0.1em' }, clip(card.eyebrow, 40)) : null,
				h(
					'div',
					{ flexDirection: 'column', fontSize: size, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.025em' },
					// An explicit newline sets the line breaks; otherwise text wraps naturally.
					clip(t, wide ? 80 : 60)
						.split('\n')
						.map((line) => h('div', { whiteSpace: 'nowrap' }, line))
				),
				card.subtitle ? h('div', { fontSize: wide ? 30 : 24, lineHeight: 1.4, color: C.fg2 }, clip(card.subtitle, wide ? 150 : 110)) : null
			),
			card.panel ? panelEl(card.panel) : null
		),
		// Footer
		h(
			'div',
			{ justifyContent: 'space-between', alignItems: 'center', margin: '0 64px', padding: '20px 0 30px', borderTop: `1px solid ${C.line}`, fontFamily: 'Plex Mono', fontSize: 17, color: C.fg3 },
			h('div', {}, 'Independent WebAssembly runtime benchmarks'),
			h('div', {}, `${meta.date} · ${clip(meta.host, 36)}`)
		),
		// Runtime color stripe
		h('div', { position: 'absolute', left: 0, right: 0, bottom: 0, height: 6 }, Object.values(RUNTIME).map((c) => h('div', { flex: 1, background: c })))
	);
}

// ── Rendering ────────────────────────────────────────────────────────────

let fonts: { name: string; data: Buffer; weight: 400 | 500 | 600; style: 'normal' }[] | null = null;
function loadFonts() {
	if (fonts) return fonts;
	const file = (pkg: string, w: number) => readFileSync(resolve(`node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff`));
	fonts = ([400, 500, 600] as const).flatMap((weight) => [
		{ name: 'Plex Sans', data: file('ibm-plex-sans', weight), weight, style: 'normal' as const },
		{ name: 'Plex Mono', data: file('ibm-plex-mono', weight), weight, style: 'normal' as const }
	]);
	return fonts;
}

const meta = () => {
	const latest = Object.values(viewData.reports)
		.map((r) => r.created)
		.sort()
		.at(-1);
	return { date: latest ? latest.slice(0, 10) : 'not measured', host: viewData.hosts.m1.label.replace(/\s*·.*$/, '') };
};

export async function renderOg(slug: string): Promise<Uint8Array> {
	const svg = await satori(cardEl(cardFor(slug), meta()) as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() });
	return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH }, font: { loadSystemFonts: false } }).render().asPng();
}
