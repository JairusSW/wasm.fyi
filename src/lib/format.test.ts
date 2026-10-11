import { describe, expect, it } from 'vitest';
import { shortCount } from './format';

describe('shortCount', () => {
	it('keeps commas below 10,000 and abbreviates above', () => {
		expect(shortCount(12)).toBe('12');
		expect(shortCount(9412)).toBe('9,412');
		expect(shortCount(48_210)).toBe('48.2K');
		expect(shortCount(100_000)).toBe('100K');
		expect(shortCount(1_384_434)).toBe('1.38M');
		expect(shortCount(2_000_000)).toBe('2M');
	});
});

describe('units at three significant figures', () => {
	it('picks the largest unit that keeps a value under 1000', async () => {
		const { fmtU, fmtUGroup } = await import('./format');
		expect(fmtU(1.026, 'ms')).toBe('1.03 ms');
		expect(fmtU(9.977, 'ms')).toBe('9.98 ms');
		expect(fmtU(0.199, 'ms')).toBe('199 µs');
		expect(fmtU(0.0049, 'ms')).toBe('4.9 µs');
		expect(fmtU(0.9997, 'ms')).toBe('1 ms');
		expect(fmtU(1500, 'ms')).toBe('1.5 s');
		expect(fmtU(16.24, 'MiB')).toBe('16.2 MiB');
		expect(fmtU(123.4, 'MiB')).toBe('123 MiB');
		expect(fmtU(2048, 'MiB')).toBe('2 GiB');
		expect(fmtU(0.49, 'KiB')).toBe('502 B');
		expect(fmtU(1.25, 'KiB')).toBe('1.25 KiB');
		expect(fmtU(512.3, 'KiB')).toBe('512 KiB');
		expect(fmtU(2048, 'KB')).toBe('2 MB');
		expect(fmtUGroup([1.026, 0.199, 9.977, null], 'ms')).toEqual(['1.03 ms', '199 µs', '9.98 ms', '']);
	});
});
