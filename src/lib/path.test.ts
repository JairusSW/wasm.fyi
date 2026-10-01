import { expect, it } from 'vitest';
import { hostedPath } from './path';
it('preserves local routing and queries under a GitHub Pages project path', () => {
	expect(hostedPath('/bench/algorithms/sum?tab=run#details', '/wasm.fyi')).toBe('/wasm.fyi/bench/algorithms/sum?tab=run#details');
	expect(hostedPath('/', '/wasm.fyi')).toBe('/wasm.fyi/');
	expect(hostedPath('/history', '')).toBe('/history');
});
it('does not double-prefix or rewrite external and hash links', () => {
	for (const path of ['/wasm.fyi/benchmarks', '/wasm.fyi?metric=steady', 'https://github.com/JairusSW/wasm.fyi', '//example.com', '#workloads']) expect(hostedPath(path, '/wasm.fyi')).toBe(path);
});
