import { describe, expect, it, vi } from 'vitest';
vi.unmock('./view-data');
import { OV } from './data/snapshot';

describe('benchmark overview categories', () => {
	it('adds a boundary call tab beside the original combined latency view', () => {
		const categories = Object.entries(OV);
		const labels = categories.map(([, category]) => category.label);
		expect(labels.indexOf('Call latency')).toBe(labels.indexOf('Latency') + 1);
		expect(OV.calls.cols).toEqual(['Wasm → host → Wasm', 'Host → Wasm → host', 'Total']);
		expect(OV.calls.metrics).toHaveLength(OV.calls.cols.length);
		expect(OV.lat.cols).toEqual(['Compilation', 'Instantiation', 'First call', 'Steady execution']);
	});
});
