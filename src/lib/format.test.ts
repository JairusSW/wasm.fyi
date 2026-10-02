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
