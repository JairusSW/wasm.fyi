import { describe, expect, it } from 'vitest';
import { check, evaluate, parse, variables } from './expr';
import { renderMarkdown } from './markdown';
import { BLOCKS, DEFAULT_LAYOUTS, TEMPLATES, defaultLayout, sanitize } from './registry';
import { PRESETS } from './presets';
import { CHART_DEFAULTS, buildDataset, toCsv, type ChartConfig } from './charts/query';
import type { Scope } from '$lib/model';

const scope: Scope = { machine: 'm1', baseline: 'A', weighting: 'corpus', hide: {}, snapshot: 's1' };
const chart = (p: Partial<ChartConfig>): ChartConfig => ({ ...structuredClone(CHART_DEFAULTS), ...p });

describe('expressions', () => {
	const vars = ['a', 'b', 'steady'];
	it('respects precedence, unary minus and right-associative powers', () => {
		const ev = (s: string, env = {}) => evaluate(parse(s, vars), env);
		expect(ev('1 + 2 * 3')).toBe(7);
		expect(ev('(1 + 2) * 3')).toBe(9);
		expect(ev('-2 ^ 2')).toBe(-4);
		expect(ev('2 ^ 3 ^ 2')).toBe(512);
		expect(ev('max(1, a, 3)', { a: 9 })).toBe(9);
		expect(ev('log10(1000)')).toBeCloseTo(3);
		expect(ev('1.5e3 / a', { a: 3 })).toBe(500);
	});
	it('treats a missing input as missing, never zero', () => {
		expect(evaluate(parse('a + steady', vars), { a: 1 })).toBeNull();
		expect(evaluate(parse('a / b', vars), { a: 1, b: 0 })).toBeNull();
	});
	it('rejects unknown identifiers, functions and syntax', () => {
		expect(check('a + nope', vars)).toMatchObject({ ok: false });
		expect(check('alert(1)', vars)).toMatchObject({ ok: false });
		expect(check('constructor', vars)).toMatchObject({ ok: false });
		expect(check('a +', vars)).toMatchObject({ ok: false });
		expect(check('a b', vars)).toMatchObject({ ok: false });
		expect(check('', vars)).toMatchObject({ ok: false });
		expect(check('max()', vars)).toMatchObject({ ok: false });
	});
	it('lists referenced variables', () => {
		expect([...variables(parse('a * max(b, 2) - -a', vars))].sort()).toEqual(['a', 'b']);
	});
});

describe('markdown', () => {
	it('escapes HTML and drops unsafe links', () => {
		const html = renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](/benchmarks)');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
		expect(html).not.toContain('href="javascript');
		expect(html).toContain('href="/benchmarks"');
	});
	it('renders the supported subset', () => {
		const html = renderMarkdown('## Title\n- one\n- **two**\n\n`code` and *em*');
		expect(html).toContain('<h4>Title</h4>');
		expect(html).toContain('<ul>');
		expect(html).toContain('<strong>two</strong>');
		expect(html).toContain('<code>code</code>');
		expect(html).toContain('<em>em</em>');
	});
	it('does not let a quote break out of an href', () => {
		expect(renderMarkdown('[x](/a"onmouseover="alert(1))')).not.toContain('" onmouseover');
	});
});

describe('layouts', () => {
	it('default layouts only reference known blocks and have stable ids', () => {
		for (const [page, specs] of Object.entries(DEFAULT_LAYOUTS)) {
			for (const s of specs) expect(BLOCKS[s.type], `${page}: ${s.type}`).toBeTruthy();
			expect(defaultLayout(page)).toEqual(defaultLayout(page));
		}
	});
	it('sanitize drops unknown blocks, clamps spans and repairs config types', () => {
		const l = sanitize({
			blocks: [
				{ id: 'x', type: 'chart', span: 99, config: { title: 5, kind: 'bar', configs: ['A', 'ZZ'] } },
				{ id: 'x', type: 'nope', span: 6, config: {} },
				{ id: '<bad id>', type: 'note', span: 0, config: { text: 'hi' } }
			]
		})!;
		expect(l.blocks.map((b) => b.type)).toEqual(['chart', 'note']);
		expect(l.blocks[0].span).toBe(12);
		expect(l.blocks[0].config.title).toBe(CHART_DEFAULTS.title);
		expect(l.blocks[0].config.configs).toEqual(['A']);
		expect(l.blocks[1].id).not.toBe('<bad id>');
		expect(l.blocks[1].span).toBe(BLOCKS.note.span); // invalid span falls back to the default width
		expect(sanitize('nope')).toBeNull();
	});
	it('every preset builds a valid layout', () => {
		for (const p of PRESETS) for (const page of p.pages ?? ['home']) expect(sanitize(p.build(page))?.blocks.length).toBe(p.build(page).blocks.length);
	});
});

describe('chart datasets', () => {
	it('every template produces a dataset without throwing', () => {
		for (const t of TEMPLATES) {
			const ds = buildDataset(scope, t.config as ChartConfig);
			expect(ds.kind, t.id).toBeTruthy();
			expect(typeof toCsv(ds)).toBe('string');
		}
	});
	it('reports bad expressions instead of drawing', () => {
		expect(buildDataset(scope, chart({ metric: 'expr', expr: 'steady +' })).error).toMatch(/Expression error/);
	});
	it('baseline normalization gives the baseline a ratio of 1', () => {
		const ds = buildDataset(scope, chart({ metric: 'steady', normalize: 'baseline', configs: ['A', 'B'] }));
		const a = ds.rows.find((r) => r.cfg.id === 'A');
		if (a?.value != null) expect(a.value).toBeCloseTo(1);
	});
	it('missing measurements are never counted as values', () => {
		const ds = buildDataset(scope, chart({ metric: 'steady', cohort: 'each' }));
		for (const r of ds.rows) {
			if (r.n === 0) expect(r.value).toBeNull();
			else expect(r.value).toBeGreaterThan(0);
		}
	});
});
