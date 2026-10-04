import { describe, expect, it } from 'vitest';
import { comparisonBaseline } from './comparison-baseline';

describe('host-local comparison baseline', () => {
	it('does not select an ARM-only engine as the AMD baseline', () => {
		expect(comparisonBaseline('A', ['D', 'E', 'G', 'L'])).toBe('D');
		expect(comparisonBaseline('A', ['A', 'D', 'G'])).toBe('A');
	});

	it('reselects the baseline on machine changes and handles a single-engine host', () => {
		const preferred = 'A';
		expect(comparisonBaseline(preferred, ['A', 'G'])).toBe('A');
		expect(comparisonBaseline(preferred, ['G'])).toBe('G');
		expect(comparisonBaseline(preferred, ['A', 'G'])).toBe('A');
	});
});
