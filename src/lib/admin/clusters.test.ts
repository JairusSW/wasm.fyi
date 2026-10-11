import {describe, expect, it} from 'vitest';
import {clusterLocations} from './clusters';

describe('geographic heat clusters', () => {
	it('connects nearby groups, retains far singletons and conserves counts', () => {
		const result = clusterLocations([{lat:0,lon:0,value:2},{lat:0,lon:1,value:3},{lat:0,lon:2,value:4},{lat:40,lon:40,value:7}]);
		expect(result).toHaveLength(2);
		expect(result.map(p => p.value).sort((a,b) => a-b)).toEqual([7,9]);
		expect(result.reduce((n,p) => n+p.value,0)).toBe(16);
	});
	it('weights centers by count without changing source city records', () => {
		const points = [{lat:0,lon:0,value:1},{lat:0,lon:1,value:3}];
		const before = JSON.stringify(points);
		const [center] = clusterLocations(points);
		expect(center.lat).toBeCloseTo(0,8);
		expect(center.lon).toBeCloseTo(0.75,4);
		expect(center.value).toBe(4);
		expect(JSON.stringify(points)).toBe(before);
	});
	it('joins across the dateline instead of centering on Greenwich', () => {
		const [center] = clusterLocations([{lat:10,lon:179.5,value:1},{lat:10,lon:-179.5,value:1}]);
		expect(Math.abs(center.lon)).toBeCloseTo(180,6);
		expect(center.value).toBe(2);
	});
});
