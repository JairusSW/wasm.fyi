import { describe, expect, it } from 'vitest';
import { ALLB } from './data/snapshot';
import { hasOwnImage, ogFor, ogSlugs, workloadSlug } from './og';

describe('share images', () => {
	it('gives every page a unique, file-safe image slug', () => {
		const slugs = ogSlugs();
		expect(new Set(slugs).size).toBe(slugs.length);
		for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
	});
	it('maps routes to their image', () => {
		expect(ogFor('/', {}, {}).slug).toBe('home');
		expect(ogFor('/benchmarks', {}, {}).slug).toBe('benchmarks');
		expect(ogFor('/[proposal=proposal]', { proposal: 'simd' }, {}).slug).toBe('simd');
		expect(ogFor('/nowhere', {}, {}).slug).toBe('home');
		const app = ALLB.find(hasOwnImage)!;
		expect(ogFor('/bench/[...id]', { id: app.id }, { bench: app }).slug).toBe(workloadSlug(app.id));
		const probe = ALLB.find((b) => !hasOwnImage(b));
		if (probe) expect(ogFor('/bench/[...id]', { id: probe.id }, { bench: probe }).slug).toBe('features');
	});
	it('every slug a page can point at is rendered', () => {
		const slugs = new Set(ogSlugs());
		for (const b of ALLB) expect(slugs.has(ogFor('/bench/[...id]', { id: b.id }, { bench: b }).slug)).toBe(true);
	});
});
