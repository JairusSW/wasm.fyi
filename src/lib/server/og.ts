// Share-image rendering. Cards are built from the same measured view and model
// functions as the pages, laid out with satori and rasterized with resvg at
// build time (the og/[slug].png endpoint is prerendered).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { CORPUS_FEATS, FEATS, PROPS } from '$lib/data/features';
import { CFG, FEATURE_CFG } from '$lib/data/runtimes';
import { ALLB } from '$lib/data/snapshot';
import type { Cfg, ProposalId } from '$lib/data/types';
import { fmtU, shortCount, workloadName } from '$lib/format';
import { PROPOSAL_IDS } from '$lib/links';
import { absOf, benchVal, compatCell, disp, featureContracts, isVisible, ratio, type Scope } from '$lib/model';
import { OG_HEIGHT, OG_WIDTH, hasOwnImage, workloadSlug } from '$lib/og';
import { viewCell, viewData } from '$lib/view-data';

// Dark theme tokens from app.css (runtime colors converted from oklch).
const C = { bg: '#0d0e10', bg2: '#131518', line: '#23272c', fg: '#e4e6e9', fg2: '#a6acb4', fg3: '#7d848d' };
const RUNTIME: Record<string, string> = { wasmtime: '#6aa7f4', wasmer: '#ebae51', wazero: '#b98cea', v8: '#4dcbc4', wago: '#e881b4' };
const runtimeColor = (rt: string) => RUNTIME[rt] ?? '#6b727b';

const scope: Scope = { machine: 'm1', baseline: 'A', weighting: 'corpus', hide: {}, snapshot: 's1' };
const ROWS = 5;

interface BarRow {
	label: string;
	value: string;
	frac: number;
	color: string;
}
type Panel = { kind: 'bars'; title: string; rows: BarRow[] } | { kind: 'stats'; items: [string, string][] };
/** A title and, when there is one, a data panel. A subtitle only appears without a panel. */
interface Card {
	title: string;
	subtitle?: string;
	panel?: Panel;
}

// ── Card content ─────────────────────────────────────────────────────────

/** Bar lengths proportional to value, from zero (each bar is also labeled). */
function fracs(values: number[]): number[] {
	const hi = Math.max(...values);
	return values.map((v) => Math.max(0.015, v / hi));
}

/** Every metric the measured view can hold (matches the packed view's metric table). */
const METRICS = ['compile', 'inst', 'first', 'steady', 'rss', 'rssCompile', 'rssInst', 'rssFirst', 'code'];

/** Workloads with at least one successful measurement; catalogued but untimed contracts don't count. */
function measuredWorkloads(): number {
	const cfgs = Object.keys(viewData.configurations) as Cfg['id'][];
	const hosts = Object.keys(viewData.hosts) as Scope['machine'][];
	return viewData.catalogue.filter((w) => hosts.some((m) => (['s1', 's2'] as const).some((sn) => cfgs.some((c) => METRICS.some((k) => viewCell(m, sn, w.id, c, k).st === 'ok'))))).length;
}

/** Engines with feature-test evidence on any host. */
function enginesWithEvidence(): number {
	const hosts = Object.keys(viewData.hosts) as Scope['machine'][];
	return new Set(FEATURE_CFG.filter((c) => hosts.some((m) => [...FEATS, ...CORPUS_FEATS].some((f) => compatCell(f.id, c.id, { ...scope, machine: m }).run))).map((c) => c.rt)).size;
}

/** Best-first list → each runtime once (its best configuration), top ROWS. */
function distinct<T extends { c: Cfg }>(sorted: T[]): T[] {
	const seen = new Set<string>();
	return sorted.filter((x) => !seen.has(x.c.rt) && seen.add(x.c.rt)).slice(0, ROWS);
}

function bars(title: string, items: { c: Cfg; v: number; text: string }[]): Panel | undefined {
	if (!items.length) return undefined;
	const f = fracs(items.map((x) => x.v));
	return { kind: 'bars', title, rows: items.map((x, i) => ({ label: x.c.rt, value: x.text, frac: f[i], color: runtimeColor(x.c.rt) })) };
}

/** Top runtimes on an aggregate column, the same ranking the pages show. */
function leaders(col: number, title: string): Panel | undefined {
	const list = CFG.filter((c) => isVisible(scope, c))
		.map((c) => ({ c, r: ratio(scope, 'lat', c.id, col), a: absOf(scope, 'lat', c.id, col) }))
		.filter((x) => x.r && x.a)
		.sort((a, b) => a.r!.r - b.r!.r);
	return bars(title, distinct(list).map((x) => ({ c: x.c, v: x.a!.v, text: disp(scope, 'lat', x.c.id, col)!.t })));
}

function workloadBars(id: string): Panel | undefined {
	const b = ALLB.find((x) => x.id === id)!;
	const list = CFG.filter((c) => isVisible(scope, c))
		.map((c) => ({ c, r: benchVal(scope, b, c.id, 'steady') }))
		.flatMap((x) => (x.r.st === 'ok' ? [{ c: x.c, v: x.r.v }] : []))
		.sort((a, b) => a.v - b.v);
	return bars('Steady execution', distinct(list).map((x) => ({ ...x, text: fmtU(x.v, 'ms') })));
}

function featureBars(family: string): Panel | undefined {
	const list = distinct(
		FEATURE_CFG.map((c) => ({ c, r: compatCell(family, c.id, scope) }))
			.filter((x) => x.r.run && x.r.total)
			.sort((a, b) => b.r.pass / b.r.total - a.r.pass / a.r.total)
	);
	if (!list.length) return undefined;
	return {
		kind: 'bars',
		title: 'Tests passed',
		rows: list.map((x) => ({ label: x.c.rt, value: `${x.r.pass}/${x.r.total}`, frac: Math.max(0.04, x.r.pass / x.r.total), color: runtimeColor(x.c.rt) }))
	};
}

function cardFor(slug: string): Card {
	if (PROPOSAL_IDS.includes(slug as ProposalId)) return { title: PROPS[slug as ProposalId].title, panel: featureBars(slug), subtitle: PROPS[slug as ProposalId].long };
	if (slug.startsWith('w-')) {
		const b = ALLB.find((x) => hasOwnImage(x) && workloadSlug(x.id) === slug);
		if (b) return { title: workloadName(b.id), subtitle: b.group, panel: workloadBars(b.id) };
	}
	const featureTests = [...FEATS, ...CORPUS_FEATS].reduce((n, f) => n + featureContracts(f.id).length, 0);
	switch (slug) {
		case 'benchmarks':
			return { title: 'Benchmarks', panel: leaders(0, 'Fastest compilation') };
		case 'history':
			return { title: 'History', panel: { kind: 'stats', items: [[String(viewData.history.m1.points.length), 'weeks'], [String(measuredWorkloads()), 'workloads run'], [viewData.statistics.timingSamples==null?'—':shortCount(viewData.statistics.timingSamples), 'samples'], [String(Object.keys(viewData.reports).length), 'reports']] } };
		case 'features':
			return { title: 'Features', panel: { kind: 'stats', items: [[String(FEATS.length), 'features'], [String(enginesWithEvidence()), 'engines tested'], [shortCount(featureTests), 'tests'], [String(Object.keys(viewData.hosts).length), 'machines']] } };
		case 'compare':
			return { title: 'Startup vs throughput', subtitle: 'When does a fast runtime that starts slowly win?' };
		default:
			return { title: 'The reference for\nWebAssembly runtimes.', panel: leaders(3, 'Fastest execution') };
	}
}

// ── Layout ───────────────────────────────────────────────────────────────

type El = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): El => ({
	type,
	props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c != null && c !== false) }
});
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const PANEL_W = 480;

function panelEl(p: Panel): El {
	if (p.kind === 'stats')
		return h(
			'div',
			{ width: PANEL_W, flexWrap: 'wrap', border: `1px solid ${C.line}`, background: C.bg2 },
			p.items.map(([v, l], i) =>
				h(
					'div',
					{ width: PANEL_W / 2 - 1, flexDirection: 'column', padding: '32px', borderRight: i % 2 === 0 ? `1px solid ${C.line}` : 'none', borderBottom: i < 2 ? `1px solid ${C.line}` : 'none' },
					h('div', { fontFamily: 'Plex Mono', fontSize: 60, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1 }, v),
					h('div', { fontSize: 22, color: C.fg3, marginTop: 10 }, l)
				)
			)
		);
	return h(
		'div',
		{ width: PANEL_W, flexDirection: 'column', gap: 20, padding: '28px 30px 32px', border: `1px solid ${C.line}`, background: C.bg2 },
		h('div', { fontSize: 22, fontWeight: 600, color: C.fg2 }, p.title),
		p.rows.map((r) =>
			h(
				'div',
				{ alignItems: 'center', gap: 14 },
				h('div', { width: 14, height: 14, background: r.color }),
				h('div', { width: 160, fontSize: 24, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden' }, clip(r.label, 12)),
				h('div', { flex: 1, height: 12, background: C.line }, h('div', { width: `${Math.round(r.frac * 100)}%`, height: 12, background: r.color })),
				h('div', { width: 104, justifyContent: 'flex-end', fontFamily: 'Plex Mono', fontSize: 22 }, r.value)
			)
		)
	);
}

function cardEl(card: Card): El {
	const wide = !card.panel;
	const t = card.title;
	// Titles never wrap mid-thought: size each line to fit its column (~0.56em per glyph).
	const lines = t.split('\n');
	const longest = Math.max(...lines.map((l) => l.length));
	const column = wide ? 1072 : 1072 - 56 - PANEL_W;
	const fit = Math.floor(column / (longest * 0.56));
	const size = lines.length > 1 || fit < 88 ? Math.max(40, Math.min(wide ? 104 : 80, fit)) : wide ? 104 : 80;
	const wrap = lines.length === 1 && fit < 40;
	return h(
		'div',
		{ width: OG_WIDTH, height: OG_HEIGHT, flexDirection: 'column', background: C.bg, color: C.fg, fontFamily: 'Plex Sans', position: 'relative', padding: '48px 64px 54px' },
		h('div', { fontFamily: 'Plex Mono', fontSize: 30, fontWeight: 600 }, 'wasm.fyi'),
		h(
			'div',
			{ flex: 1, alignItems: 'center', gap: 56 },
			h(
				'div',
				{ flex: 1, flexDirection: 'column', gap: 20 },
				h(
					'div',
					{ flexDirection: 'column', fontSize: size, fontWeight: 600, lineHeight: 1.04, letterSpacing: '-0.03em' },
					lines.map((line) => h('div', wrap ? {} : { whiteSpace: 'nowrap' }, clip(line, 48)))
				),
				card.subtitle ? h('div', { fontSize: wide ? 34 : 26, lineHeight: 1.35, color: C.fg3 }, clip(card.subtitle, 70)) : null
			),
			card.panel ? panelEl(card.panel) : null
		),
		// Runtime color stripe
		h('div', { position: 'absolute', left: 0, right: 0, bottom: 0, height: 8 }, Object.values(RUNTIME).map((c) => h('div', { flex: 1, background: c })))
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

export async function renderOg(slug: string): Promise<Uint8Array> {
	const svg = await satori(cardEl(cardFor(slug)) as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() });
	return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH }, font: { loadSystemFonts: false } }).render().asPng();
}
