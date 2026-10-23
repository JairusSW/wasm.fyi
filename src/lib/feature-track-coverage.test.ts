import { expect, it } from 'vitest';
import { featureTrackCoverage } from './feature-track-coverage';

it('does not render newer uncollected contracts as snapshot failures', () => {
	expect(featureTrackCoverage({ pass: 15, measured: 15, expected: 21 })).toEqual({
		total: 15,
		missing: 6,
		fraction: 1,
		text: '15/15'
	});
});
