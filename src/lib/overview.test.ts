import { describe, expect, it } from 'vitest';
import { OV } from './data/snapshot';

describe('benchmark overview categories', () => {
	it('keeps compilation and boundary call latency side by side', () => {
		const categories = Object.entries(OV);
		const labels = categories.map(([, category]) => category.label);
		expect(labels.indexOf('Call latency')).toBe(labels.indexOf('Compilation latency') + 1);
		expect(OV.compile.cols).toEqual(['Compilation']);
		expect(OV.calls.cols).toEqual(['Wasm → host', 'Host → Wasm']);
		expect(OV.lat.cols).toEqual(['Instantiation', 'First call', 'Steady execution']);
	});
});
