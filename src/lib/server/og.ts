// Share-image rendering. Each card pairs the page's headline with a dot-matrix
// illustration in the brand's 8×8 logo style, laid out with satori and
// rasterized with resvg at build time (the og/[slug].png endpoint is
// prerendered). Cards carry no measurements: the build has no live data, and
// link previews are cached far longer than any capture stays current.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { OG_HEIGHT, OG_WIDTH, ogCard, type OgCard, type OgSlug } from '$lib/og';

// Dark theme tokens from app.css (runtime and status colors converted from oklch).
const C = { bg: '#0d0e10', bg2: '#131518', line: '#23272c', fg: '#e4e6e9', fg2: '#a6acb4', fg3: '#7d848d' };
const RUNTIMES = ['#6aa7f4', '#ebae51', '#b98cea', '#4dcbc4', '#e881b4'];
const PASS = '#4fc27a';
const WARN = '#eba24e';
const FAIL = '#ec5f50';

// ── Dot-matrix illustrations ─────────────────────────────────────────────

/** A grid of palette indices: -1 is an unlit dot, -2 is no dot, DIM + i is a dimmed color. */
type Grid = number[][];
/** Palette for grid indices; 5 = foreground, 6–8 = status colors. */
const PALETTE = [...RUNTIMES, C.fg, PASS, WARN, FAIL];
const FG = 5;
/** Added to a palette index for a dimmed dot. */
const DIM = 10;

const blank = (w: number, h: number, v = -1): Grid => Array.from({ length: h }, () => Array(w).fill(v));

/** Small deterministic noise, so patterns look organic but render identically every build. */
function rng(seed: number) {
	return () => ((seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 2 ** 32);
}

/** Plot a function into a grid column by column, bridging vertical jumps so lines stay continuous. */
function plot(g: Grid, color: number, f: (x: number) => number) {
	const h = g.length;
	let prev: number | null = null;
	for (let x = 0; x < g[0].length; x++) {
		const y = Math.max(0, Math.min(h - 1, Math.round(h - 1 - f(x))));
		// Bridge in the current column, stopping one short of the previous row (already lit).
		const from = prev == null ? y : prev + Math.sign(y - prev);
		for (let yy = Math.min(from, y); yy <= Math.max(from, y); yy++) g[yy][x] = color;
		prev = y;
	}
}

// The logo mark, row by row (1 = lit).
const MARK = ['00000011', '00000011', '00000011', '00011011', '00011011', '11011011', '11011011', '11011011'];

const ART: Record<OgSlug, () => Grid> = {
	// The logo mark, each column in a runtime color.
	home: () => MARK.map((row) => [...row].map((c, x) => (c === '1' ? [0, 0, 1, 2, 2, 3, 4, 4][x] : -1))),
	// Ranked horizontal bars, one per runtime.
	benchmarks: () => {
		const g = blank(14, 14);
		[13, 11, 8, 6, 4].forEach((len, i) => {
			for (let x = 0; x < len; x++) g[i * 3][x] = g[i * 3 + 1][x] = i;
		});
		return g;
	},
	// Three series trending over time.
	history: () => {
		const g = blank(16, 12);
		plot(g, 1, (x) => 9.4 - x * 0.2 + Math.sin(x * 0.8) * 0.5);
		plot(g, 0, (x) => 5.8 - x * 0.1 + Math.sin(x * 0.6 + 2) * 0.45);
		plot(g, 3, (x) => 1.8 + Math.sin(x * 0.5 + 1) * 0.4);
		return g;
	},
	// A compatibility matrix: runtimes down the side, tests across.
	features: () => {
		const r = rng(7);
		const g = blank(13, 10, -2);
		for (let y = 0; y < 5; y++) {
			g[y * 2][0] = y;
			g[y * 2 + 1][0] = -2;
			for (let x = 2; x < 13; x++) {
				const p = r() + y * 0.035;
				g[y * 2][x] = p < 0.74 ? 6 : p < 0.88 ? 7 : p < 0.95 ? 8 : -1;
			}
		}
		return g;
	},
	// High startup, low slope vs low startup, high slope: the lines cross.
	compare: () => {
		const g = blank(15, 12);
		plot(g, 1, (x) => 0.4 + x * 0.78);
		plot(g, 0, (x) => 4.6 + x * 0.26);
		g[11 - Math.round(4.6 + 8 * 0.26)][8] = FG;
		return g;
	},
		health: () => {
		const r = rng(3);
		const g = blank(14, 9, -2);
		for (let y = 0; y < 9; y += 2) for (let x = 0; x < 14; x++) g[y][x] = r() < 0.9 ? 6 : r() < 0.6 ? 7 : 8;
		return g;
	},
	// One program measured on every runtime: lines of code beside five result bars.
	workload: () => {
		const g = blank(15, 9, -2);
		[3, 2, 3, 1, 2, 3, 2, 1, 3].forEach((len, y) => {
			for (let x = 0; x < 3; x++) g[y][x] = x < len ? FG : -1;
		});
		[10, 7, 9, 4, 6].forEach((len, i) => {
			for (let x = 5; x < 15; x++) g[i * 2][x] = x < 5 + len ? i : -1;
		});
		return g;
	},
	// Four 32-bit lanes of a 128-bit vector: a + b = c, lane by lane.
	simd: () => {
		const g = blank(15, 11, -2);
		const lanes = (y: number, lit: boolean) => {
			for (let lane = 0; lane < 4; lane++) for (let x = 0; x < 3; x++) g[y][lane * 4 + x] = lit ? lane : lane + DIM;
		};
		lanes(0, false);
		lanes(1, false);
		lanes(3, false);
		lanes(4, false);
		for (let x = 0; x < 15; x++) if ((x + 1) % 4) g[6][x] = FG;
		lanes(8, true);
		lanes(9, true);
		lanes(10, true);
		return g;
	},
	// A heap graph: objects reachable from a root, and two unreachable ones.
	gc: () => {
		const g = blank(15, 11, -2);
		const node = (x: number, y: number, c: number) => {
			g[y][x] = g[y][x + 1] = g[y + 1][x] = g[y + 1][x + 1] = c;
		};
		const edge = (x0: number, y0: number, x1: number, y1: number) => {
			for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) g[y][x] = -1;
		};
		edge(7, 2, 7, 3);
		edge(2, 3, 12, 3);
		edge(2, 4, 2, 4);
		edge(12, 4, 12, 4);
		edge(2, 7, 2, 8);
		edge(7, 7, 7, 8);
		node(6, 0, FG);
		node(1, 5, 0);
		node(6, 5, 1);
		node(11, 5, 2);
		node(1, 9, 3);
		node(6, 9, 4);
		node(11, 9, FG + DIM);
		return g;
	},
	// A 32-bit address space, then a 64-bit one that keeps going.
	memory64: () => {
		const g = blank(16, 11, -2);
		for (let y = 0; y < 3; y++) for (let x = 0; x < 16; x++) g[y][x] = x < 6 ? 2 : -1;
		for (let y = 5; y < 11; y++) for (let x = 0; x < 16; x++) g[y][x] = 0;
		for (let x = 0; x < 16; x += 1) g[4][x] = -2;
		return g;
	},
	// Four workers in parallel, meeting at barriers.
	threads: () => {
		const r = rng(11);
		const g = blank(16, 9, -2);
		for (let t = 0; t < 4; t++) {
			const y = t * 2;
			for (let x = 0; x < 16; x++) g[y][x] = x === 5 || x === 11 ? FG : r() < 0.82 ? t : -1;
		}
		for (const x of [5, 11]) for (let y = 0; y < 7; y++) if (g[y][x] === -2) g[y][x] = FG;
		return g;
	}
};

/** Render a grid as an SVG data URI at a given dot pitch. */
function gridImage(g: Grid, pitch: number) {
	const w = g[0].length * pitch;
	const h = g.length * pitch;
	const r = pitch * 0.36;
	let dots = '';
	g.forEach((row, y) =>
		row.forEach((c, x) => {
			if (c === -2) return;
			const cx = (x + 0.5) * pitch;
			const cy = (y + 0.5) * pitch;
			const [fill, opacity] = c === -1 ? [C.fg, 0.09] : c >= DIM ? [PALETTE[c - DIM], 0.3] : [PALETTE[c], 1];
			dots += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}/>`;
		})
	);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${dots}</svg>`;
	return { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, w, h };
}

/** Faint full-bleed dot field that fades toward the left, behind the text. */
function backdrop() {
	const pitch = 30;
	let dots = '';
	for (let y = pitch / 2; y < OG_HEIGHT; y += pitch)
		for (let x = pitch / 2; x < OG_WIDTH; x += pitch) {
			const o = Math.max(0, (x / OG_WIDTH - 0.25) * 0.075);
			if (o > 0.004) dots += `<circle cx="${x}" cy="${y}" r="1.6" fill="${C.fg}" fill-opacity="${o.toFixed(3)}"/>`;
		}
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">${dots}</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** The dot-matrix logo from static/brand/logo.svg, recolored for the dark card. */
let logoSrc: string | null = null;
function logo() {
	if (logoSrc) return logoSrc;
	const svg = readFileSync(resolve('static/brand/logo.svg'), 'utf8')
		.replace(/<title>.*?<\/title>/, '')
		.replace(/<style>[\s\S]*?<\/style>/, '')
		.replaceAll('class="on"', `fill="${C.fg}"`)
		.replaceAll('class="off"', `fill="${C.fg}" fill-opacity="0.14"`);
	return (logoSrc = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

// ── Layout ───────────────────────────────────────────────────────────────

type El = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): El => ({
	type,
	props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c != null && c !== false) }
});
const img = (src: string, width: number, height: number, style: Record<string, unknown> = {}): El => ({ type: 'img', props: { src, width, height, style } });

const PAD = 72;
const ART_BOX = 400;

function cardEl(card: OgCard, slug: OgSlug): El {
	const grid = ART[slug]();
	const pitch = Math.floor(Math.min(ART_BOX / grid[0].length, ART_BOX / grid.length, 46));
	const art = gridImage(grid, pitch);
	const lines = card.headline.split('\n');
	// Size the headline so its longest line fits the text column (~0.55em per glyph in Plex Sans 600).
	const column = OG_WIDTH - PAD * 2 - ART_BOX - 56;
	const longest = Math.max(...lines.map((l) => l.length));
	const size = Math.max(52, Math.min(lines.length > 1 ? 84 : 104, Math.floor(column / (longest * 0.55))));
	return h(
		'div',
		{ width: OG_WIDTH, height: OG_HEIGHT, flexDirection: 'column', background: C.bg, color: C.fg, fontFamily: 'Plex Sans', position: 'relative' },
		img(backdrop(), OG_WIDTH, OG_HEIGHT, { position: 'absolute', left: 0, top: 0 }),
		// Header: logo and kicker
		h(
			'div',
			{ alignItems: 'center', justifyContent: 'space-between', padding: `56px ${PAD}px 0` },
			img(logo(), Math.round((51 / 9) * 40), 40),
			h(
				'div',
				{ alignItems: 'center', gap: 12, fontFamily: 'Plex Mono', fontSize: 20, fontWeight: 500, color: C.fg2, letterSpacing: '0.08em', textTransform: 'uppercase' },
				h('div', { width: 10, height: 10, borderRadius: 5, background: PASS }),
				card.kicker
			)
		),
		// Body: headline and illustration
		h(
			'div',
			{ flex: 1, alignItems: 'center', justifyContent: 'space-between', padding: `0 ${PAD}px`, gap: 56 },
			h(
				'div',
				{ width: column, flexDirection: 'column', gap: 26 },
				h(
					'div',
					{ flexDirection: 'column', fontSize: size, fontWeight: 600, lineHeight: 1.02, letterSpacing: '-0.035em' },
					lines.map((line) => h('div', {}, line))
				),
				h('div', { fontSize: 28, lineHeight: 1.38, color: C.fg2, maxWidth: column }, card.subtitle)
			),
			h('div', { width: ART_BOX, height: ART_BOX, alignItems: 'center', justifyContent: 'center' }, img(art.src, art.w, art.h))
		),
		// Footer: canonical path
		h(
			'div',
			{ alignItems: 'center', justifyContent: 'space-between', padding: `0 ${PAD}px 44px`, fontFamily: 'Plex Mono', fontSize: 22, color: C.fg3 },
			h('div', {}, h('span', { color: C.fg2 }, 'wasm.fyi'), card.path),
			h('div', {}, 'Every number links to its run')
		),
		// Runtime color stripe
		h('div', { position: 'absolute', left: 0, right: 0, bottom: 0, height: 8 }, RUNTIMES.map((c) => h('div', { flex: 1, background: c })))
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

export async function renderOg(slug: OgSlug): Promise<Uint8Array> {
	const svg = await satori(cardEl(ogCard(slug), slug) as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() });
	return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH }, font: { loadSystemFonts: false } }).render().asPng();
}
