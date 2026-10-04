import { describe, expect, it, vi } from 'vitest';
import { callRoundTrip, overallScores } from './rankings';
import { CFG } from './data/runtimes';
import * as measured from './view-data';

describe('overall runtime rankings', () => {
	it('balances categories independently of their units and magnitude', () => {
		const rows = [{item:'a',values:[1,2,1,2,1]}, {item:'b',values:[2,1,2,1,2]}];
		const ranked = overallScores(rows);
		expect(ranked[0].item).toBe('a');
		expect(ranked[0].score).toBeCloseTo(2 ** (2/5));
		const rescaled = overallScores(rows.map(row => ({...row,values:row.values.map((v,i) => v * [1000,.001,1e6,10,100][i])})));
		expect(rescaled).toEqual(ranked);
	});
	it('excludes incomplete, invalid and zero measurements before normalization', () => {
		const ranked = overallScores([
			{item:'complete',values:[2,2,2,2,2]},
			{item:'missing',values:[1,1,1,null,1]},
			{item:'zero',values:[0,1,1,1,1]},
			{item:'invalid',values:[1,1,NaN,1,1]}
		]);
		expect(ranked).toEqual([{item:'complete',score:1}]);
		expect(overallScores([])).toEqual([]);
	});
});


describe('call round-trip ranking', () => {
	it('sums both directions and excludes a missing direction', () => {
		const cell = vi.spyOn(measured, 'viewCell');
		const scope = {machine:'m1' as const, baseline:'G' as const, weighting:'corpus' as const, hide:{}};
		try {
			cell.mockImplementation((_machine, _snap, workload) => ({st:'ok',v:workload.includes('wasm-to-host') ? .0003 : .00002,report:'test'}));
			expect(callRoundTrip(scope, CFG[0])).toBeCloseTo(.00032);
			cell.mockImplementation((_machine, _snap, workload) => workload.includes('wasm-to-host') ? {st:'ok',v:.0003,report:'test'} : {st:'nm',report:''});
			expect(callRoundTrip(scope, CFG[0])).toBeNull();
		} finally {
			cell.mockRestore();
		}
	});
});
