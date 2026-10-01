/** Measured-data boundary. View slots and preview names are never runtime identities. */
export interface MeasuredHost { hostname: string; os: string; arch: string }
export interface SnapshotEntry {
	id: string; runId: string; created: string; host: MeasuredHost;
	projection: string; projectionSha256: string; evidence: string; evidenceSha256: string;
}
export interface MeasuredRuntime {
	id: string;
	description: { runtime: string; runtime_version: string; backend: string; [key: string]: unknown };
	file_sha256: Record<string, string>;
}
export interface MeasuredWorkload {
	id: string; sha256: string; work_unit: string; units_per_invocation: number;
	provenance?: { scope?: string; baseline?: boolean; [key: string]: unknown };
}
export interface TimingSummary {
	runtime: string; workload: string; scenario: string; profile: string;
	outcomes: Record<string, number>; latency_status: string;
	median_ns_per_operation: number | null; ci95_low?: number | null; ci95_high?: number | null;
	independent_launches: number; sample_count: number;
}
export interface MeasuredSnapshot {
	id: string; runId: string; created: string; host: MeasuredHost;
	sourceReportSha256: string;
	options: { launches: number };
	evidence: string; evidenceSha256: string;
	runtimes: MeasuredRuntime[]; workloads: MeasuredWorkload[]; summaries: TimingSummary[];
	memory: { runtime: string; workload: string; scenario: string; metric: string; median_bytes: number; ci95_low_bytes?: number; ci95_high_bytes?: number; independent_launches: number }[];
	codeRecords: { runtime: string; workload: string; status: string; image_bytes?: number; [key: string]: unknown }[];
}

export interface MeasuredWeeklyHistory {
	baseline: { report: string };
	results: { targetWeek: string; revision: string; collectedAt?: string; status: string; runId?: string; reportSha256?: string }[];
}

/** Retrospective Wago measurements and fixed comparisons have different provenance. No interpolation. */
export function measuredHistory(history: MeasuredWeeklyHistory, snapshots: MeasuredSnapshot[], host: MeasuredHost, runtime: string, workload: string, artifactSha256: string, scenario: string) {
	const baseline = snapshots.find(snapshot => snapshot.id === history.baseline.report);
	return history.results.map(week => {
		const role = runtime === 'wago' ? 'retrospective-revision' as const : 'fixed-comparison-baseline' as const;
		const snapshot = runtime === 'wago' ? snapshots.find(snapshot => snapshot.runId === week.runId) : baseline;
		let cell: MeasuredCell;
		if (week.status !== 'measured' || !snapshot) cell = { status: 'not-collected', reason: 'This historical point was not collected.' };
		else if (measuredHostKey(snapshot.host) !== measuredHostKey(host)) cell = { status: 'not-collected', reason: 'This historical report belongs to a different host.' };
		else {
			if (runtime === 'wago' && (snapshot.created !== week.collectedAt || snapshot.sourceReportSha256 !== week.reportSha256)) throw new Error('Historical report differs from its weekly manifest');
			cell = measuredTiming(snapshot, runtime, workload, artifactSha256, scenario);
		}
		return { targetWeek: week.targetWeek, revision: runtime === 'wago' ? week.revision : undefined, role, cell };
	});
}
export interface EvidenceReference { report: string; runId: string; collectedAt: string; evidence: string; sha256: string }
export type MeasuredCell =
	| { status: 'ok'; value: number; unit: 'ns/invocation' | 'bytes'; interval?: [number, number]; evidence: EvidenceReference }
	| { status: 'unsupported' | 'failed' | 'not-measured' | 'not-collected'; reason: string; evidence?: EvidenceReference };

export const measuredHostKey = (host: MeasuredHost) => JSON.stringify([host.hostname, host.os, host.arch]);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const reference = (snapshot: MeasuredSnapshot): EvidenceReference => ({ report: snapshot.id, runId: snapshot.runId, collectedAt: snapshot.created, evidence: snapshot.evidence, sha256: snapshot.evidenceSha256 });
const interval = (low: unknown, high: unknown): [number, number] | undefined => {
	if (low == null && high == null) return undefined;
	if (!finite(low) || !finite(high) || low > high) throw new Error('Invalid measured interval');
	return [low, high];
};

function contract(snapshot: MeasuredSnapshot, runtime: string, workload: string, artifactSha256: string): MeasuredCell | undefined {
	if (!snapshot.runtimes.some(config => config.id === runtime)) return { status: 'not-collected', reason: 'This pinned configuration was not collected in this report.' };
	const item = snapshot.workloads.find(item => item.id === workload);
	if (!item) return { status: 'not-collected', reason: 'This exact workload contract was not collected in this report.' };
	if (item.sha256 !== artifactSha256) return { status: 'not-collected', reason: 'The measured artifact differs from the requested artifact.' };
	return undefined;
}

function outcome(snapshot: MeasuredSnapshot, runtime: string, workload: string, scenario: string): MeasuredCell | undefined {
	const summary = snapshot.summaries.find(item => item.runtime === runtime && item.workload === workload && item.scenario === scenario && item.profile === 'timing');
	if (!summary) return { status: 'not-measured', reason: 'No timing outcome was collected for this scenario.', evidence: reference(snapshot) };
	if (Object.entries(summary.outcomes).some(([status, count]) => count > 0 && status !== 'ok' && status !== 'unsupported')) {
		return { status: 'failed', reason: 'At least one launch failed; no performance credit is assigned.', evidence: reference(snapshot) };
	}
	if (!(summary.outcomes.ok > 0)) return { status: summary.outcomes.unsupported > 0 ? 'unsupported' : 'not-measured', reason: 'No successful launch was recorded.', evidence: reference(snapshot) };
	return undefined;
}

/** Nanoseconds per measured invocation. Guest-operation throughput needs workload.units_per_invocation. */
export function measuredTiming(snapshot: MeasuredSnapshot, runtime: string, workload: string, artifactSha256: string, scenario: string): MeasuredCell {
	const missing = contract(snapshot, runtime, workload, artifactSha256) ?? outcome(snapshot, runtime, workload, scenario);
	if (missing) return missing;
	const summary = snapshot.summaries.find(item => item.runtime === runtime && item.workload === workload && item.scenario === scenario && item.profile === 'timing')!;
	if (!finite(summary.median_ns_per_operation) || summary.latency_status === 'failed_cell' || summary.sample_count <= 0 || summary.independent_launches <= 0) throw new Error('Successful timing lacks valid measured samples');
	return { status: 'ok', value: summary.median_ns_per_operation, unit: 'ns/invocation', interval: interval(summary.ci95_low, summary.ci95_high), evidence: reference(snapshot) };
}

/** Exact observer and scenario only: heap, RSS, PSS, totals and deltas are different metrics. */
export function measuredMemory(snapshot: MeasuredSnapshot, runtime: string, workload: string, artifactSha256: string, scenario: string, metric: string): MeasuredCell {
	const missing = contract(snapshot, runtime, workload, artifactSha256) ?? outcome(snapshot, runtime, workload, scenario);
	if (missing) return missing;
	const measurement = snapshot.memory.find(item => item.runtime === runtime && item.workload === workload && item.scenario === scenario && item.metric === metric);
	if (!measurement) return { status: 'not-measured', reason: 'This exact memory observer and boundary were not measured.', evidence: reference(snapshot) };
	if (measurement.independent_launches !== snapshot.options.launches) return { status: 'not-measured', reason: 'The memory observer has incomplete independent-launch coverage.', evidence: reference(snapshot) };
	if (!finite(measurement.median_bytes)) throw new Error('Invalid measured memory');
	return { status: 'ok', value: measurement.median_bytes, unit: 'bytes', interval: interval(measurement.ci95_low_bytes, measurement.ci95_high_bytes), evidence: reference(snapshot) };
}

/** The pinned extracted image size; this does not imply active or cumulative function-code bytes. */
export function measuredCodeImage(snapshot: MeasuredSnapshot, runtime: string, workload: string, artifactSha256: string): MeasuredCell {
	const missing = contract(snapshot, runtime, workload, artifactSha256) ?? outcome(snapshot, runtime, workload, 'compile');
	if (missing) return missing;
	const records = snapshot.codeRecords.filter(item => item.runtime === runtime && item.workload === workload);
	if (!records.length || records.some(item => item.status !== 'available')) return { status: 'not-measured', reason: 'A complete extracted code image is unavailable.', evidence: reference(snapshot) };
	const values = records.map(item => item.image_bytes);
	if (!values.every(finite)) throw new Error('Invalid code image size');
	// Image extraction is deterministic; incompatible sizes must not be reduced to a headline median.
	if (!values.every(value => value === values[0])) return { status: 'not-measured', reason: 'Extracted code images disagree across trials.', evidence: reference(snapshot) };
	return { status: 'ok', value: values[0]!, unit: 'bytes', evidence: reference(snapshot) };
}

/** Fetch the compact projection and check its bytes and metadata against the published index. */
export async function loadMeasuredSnapshot(basePath: string, entry: SnapshotEntry, fetcher: typeof fetch = fetch): Promise<MeasuredSnapshot> {
	if (!/^[a-f0-9]{64}\.summary\.json$/.test(entry.projection) || !/^[a-f0-9]{64}$/.test(entry.projectionSha256)) throw new Error('Invalid snapshot projection reference');
	const response = await fetcher(basePath.replace(/\/+$/, '') + '/' + entry.projection);
	if (!response.ok) throw new Error('Snapshot request failed: ' + response.status);
	const bytes = await response.arrayBuffer();
	const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
	if (digest !== entry.projectionSha256) throw new Error('Snapshot projection checksum mismatch');
	const snapshot = JSON.parse(new TextDecoder().decode(bytes)) as MeasuredSnapshot;
	if (snapshot.id !== entry.id || snapshot.runId !== entry.runId || snapshot.created !== entry.created || snapshot.evidence !== entry.evidence || snapshot.evidenceSha256 !== entry.evidenceSha256 || measuredHostKey(snapshot.host) !== measuredHostKey(entry.host)) throw new Error('Snapshot metadata differs from its index');
	return snapshot;
}
