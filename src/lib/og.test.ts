import { describe, expect, it, vi } from 'vitest';
// Share metadata is static; it must not depend on a production capture.
vi.unmock('./view-data');
import { PROPOSAL_IDS } from './links';
import { ogCard, ogFor, ogManifest, ogSlugs } from './og';

describe('share images', () => {
	it('gives every page a unique, file-safe image slug with card text', () => {
		const slugs = ogSlugs();
		expect(new Set(slugs).size).toBe(slugs.length);
		for (const s of slugs) {
			expect(s).toMatch(/^[a-z0-9-]+$/);
			expect(ogCard(s).headline).toBeTruthy();
		}
	});
	it('maps routes to their image', () => {
		expect(ogFor('/', {}).slug).toBe('home');
		expect(ogFor('/benchmarks', {}).slug).toBe('benchmarks');
		expect(ogFor('/[proposal=proposal]', { proposal: 'simd' }).slug).toBe('simd');
		expect(ogFor('/nowhere', {}).slug).toBe('home');
		const bench = ogFor('/bench/[...id]', { id: 'applications/image-blur/' });
		expect(bench.slug).toBe('workload');
		expect(bench.title).toBe('image-blur · wasm.fyi');
	});
	it('every slug a page can point at is rendered', () => {
		const slugs = new Set(ogSlugs());
		const routes: [string, Record<string, string>][] = [['/', {}], ['/benchmarks', {}], ['/history', {}], ['/features', {}], ['/compare', {}], ['/health', {}], ['/bench/[...id]', { id: 'a/b' }], ...PROPOSAL_IDS.map((proposal) => ['/[proposal=proposal]', { proposal }] as [string, Record<string, string>])];
		for (const [route, params] of routes) expect(slugs.has(ogFor(route, params).slug)).toBe(true);
	});
	it('manifest covers every hosted page and agrees with the page head', () => {
		const m = ogManifest();
		expect(m.origin).toMatch(/^https:\/\//);
		expect(Object.keys(m.pages).sort()).toEqual(['', '/benchmarks', '/compare', '/features', '/health', '/history', ...PROPOSAL_IDS.map((id) => '/' + id)].sort());
		expect(m.pages['/simd']).toEqual({ ...ogFor('/[proposal=proposal]', { proposal: 'simd' }), slug: undefined, image: '/og/simd.png' } as never);
		for (const page of Object.values(m.pages)) expect(ogSlugs().map((s) => `/og/${s}.png`)).toContain(page.image);
	});
});
