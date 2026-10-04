import { describe, expect, it } from 'vitest';
import { OV } from './data/snapshot';

describe('benchmark overview categories', () => {
	it('adds a boundary call tab beside the original combined latency view', () => {
		const categories = Object.entries(OV);
		const labels = categories.map(([, category]) => category.label);
		expect(labels.indexOf('Call latency')).toBe(labels.indexOf('Latency') + 1);
		expect(OV.calls.cols).toEqual(['Wasm → host', 'Host → Wasm', 'Round trip']);
		expect(OV.lat.cols).toEqual(['Compilation', 'Instantiation', 'First call', 'Steady execution']);
	});
});
