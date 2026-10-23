export interface FeatureTrackCoverageInput {
	pass: number;
	measured: number;
	expected: number;
}

/** Coverage for one immutable snapshot; newer catalogue rows are missing, not failures. */
export function featureTrackCoverage(track: FeatureTrackCoverageInput) {
	const total = track.measured;
	return {
		total,
		missing: Math.max(0, track.expected - total),
		fraction: total ? track.pass / total : 0,
		text: total ? `${track.pass}/${total}` : '—'
	};
}
