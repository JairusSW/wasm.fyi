import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadMeasuredSnapshot, measuredCodeImage, measuredHistory, measuredMemory, measuredTiming, type MeasuredSnapshot, type MeasuredWeeklyHistory, type SnapshotEntry } from './measured';

const root = new URL('../../data/', import.meta.url);
async function store(name: string) {
	const index = JSON.parse(await readFile(new URL(name + '/index.json', root), 'utf8')) as { reports: SnapshotEntry[] };
	const snapshots = await Promise.all(index.reports.map(async entry => JSON.parse(await readFile(new URL(name + '/' + entry.projection, root), 'utf8')) as MeasuredSnapshot));
	return { index, snapshots };
}
const { index, snapshots } = await store('wasmbench');
const feature = snapshots.find(snapshot => snapshot.host.os === 'linux' && snapshot.workloads.some(workload => workload.id.startsWith('features/')) && snapshot.runtimes.some(runtime => runtime.id === 'wasmtime-component-async'))!;
const item = feature.workloads.find(workload => workload.id === 'features/core-num/integer-multiply-add/1')!;

describe('measured view boundary', () => {
	it('reads actual host-specific timing and keeps engine IDs distinct from preview slots', () => {
		const summary = feature.summaries.find(summary => summary.runtime === 'wasmtime' && summary.workload === item.id && summary.scenario === 'steady')!;
		const cell = measuredTiming(feature, 'wasmtime', item.id, item.sha256, 'steady');
		expect(cell.status).toBe('ok');
		if (cell.status === 'ok') { expect(cell.value).toBe(summary.median_ns_per_operation); expect(cell.unit).toBe('ns/invocation'); expect(cell.evidence.runId).toBe(feature.runId); }
		expect(measuredTiming(feature, 'A', item.id, item.sha256, 'steady').status).toBe('not-collected');
		expect(measuredTiming(feature, 'wasmtime', item.id, '0'.repeat(64), 'steady').status).toBe('not-collected');
	});

	it('withholds mixed successful and failed launches rather than averaging them', () => {
		const copy = structuredClone(feature);
		const summary = copy.summaries.find(summary => summary.runtime === 'wasmtime' && summary.workload === item.id && summary.scenario === 'steady')!;
		summary.outcomes = { ok: 2, preflight_failed: 1 };
		expect(measuredTiming(copy, 'wasmtime', item.id, item.sha256, 'steady').status).toBe('failed');
		expect(measuredMemory(copy, 'wasmtime', item.id, item.sha256, 'steady', 'host.js_heap.end').status).toBe('failed');
	});

	it('never substitutes heap for RSS or compile-only support for execution', () => {
		const memory = feature.memory.find(memory => memory.runtime === 'v8-optimizing-only' && memory.workload === item.id && memory.scenario === 'compile' && memory.metric === 'host.js_heap.end')!;
		const cell = measuredMemory(feature, 'v8-optimizing-only', item.id, item.sha256, 'compile', memory.metric);
		expect(cell.status).toBe('ok');
		if (cell.status === 'ok') expect(cell.value).toBe(memory.median_bytes);
		const incomplete = structuredClone(feature);
		incomplete.memory.find(value => value.runtime === memory.runtime && value.workload === memory.workload && value.scenario === memory.scenario && value.metric === memory.metric)!.independent_launches--;
		expect(measuredMemory(incomplete, 'v8-optimizing-only', item.id, item.sha256, 'compile', memory.metric).status).toBe('not-measured');
		expect(measuredMemory(feature, 'v8-optimizing-only', item.id, item.sha256, 'compile', 'invented.rss').status).toBe('not-measured');
		const async = feature.workloads.find(workload => workload.id === 'features/cm-async/future-stream-compile/1')!;
		expect(measuredTiming(feature, 'wasmtime-component-async', async.id, async.sha256, 'compile').status).toBe('ok');
		expect(measuredTiming(feature, 'wasmtime-component-async', async.id, async.sha256, 'steady').status).toBe('unsupported');
	});

	it('exposes code images as images and rejects conflicting sizes', () => {
		const cell = measuredCodeImage(feature, 'wasmtime', item.id, item.sha256);
		expect(cell.status).toBe('ok');
		const copy = structuredClone(feature);
		const record = copy.codeRecords.find(record => record.runtime === 'wasmtime' && record.workload === item.id)!;
		copy.codeRecords.push({ ...record, image_bytes: record.image_bytes! + 1 });
		expect(measuredCodeImage(copy, 'wasmtime', item.id, item.sha256).status).toBe('not-measured');
	});

	it('checks deployed projection bytes, metadata and hosted base paths', async () => {
		const entry = index.reports[0];
		const bytes = await readFile(new URL('wasmbench/' + entry.projection, root), 'utf8');
		const fetcher = (async (path: string) => { expect(path).toBe('/wasm.fyi/wasmbench/' + entry.projection); return new Response(bytes); }) as typeof fetch;
		expect((await loadMeasuredSnapshot('/wasm.fyi/wasmbench/', entry, fetcher)).id).toBe(entry.id);
		await expect(loadMeasuredSnapshot('/wasm.fyi/wasmbench', entry, (async () => new Response(bytes + ' ')) as typeof fetch)).rejects.toThrow('checksum');
		await expect(loadMeasuredSnapshot('/wasm.fyi/wasmbench', { ...entry, host: { ...entry.host, hostname: 'wrong-host' } }, fetcher)).rejects.toThrow('metadata');
	});

	it('reads all eight weeks on both hosts and retains fixed-baseline provenance and gaps', async () => {
		for (const name of ['history', 'history-hub']) {
			const { snapshots } = await store(name);
			const history = JSON.parse(await readFile(new URL(name + '/weekly.json', root), 'utf8')) as MeasuredWeeklyHistory;
			const historical = snapshots.find(snapshot => snapshot.runId === history.results[0].runId)!;
			const workload = historical.workloads.find(workload => workload.id.includes('/nbody/'))!;
			const cells = measuredHistory(history, snapshots, historical.host, 'wago', workload.id, workload.sha256, 'steady');
			expect(cells).toHaveLength(8);
			expect(cells.every(point => point.role === 'retrospective-revision' && point.cell.status === 'ok')).toBe(true);
			const baseline = measuredHistory(history, snapshots, historical.host, 'wasmtime', workload.id, workload.sha256, 'steady');
			expect(baseline.every(point => point.role === 'fixed-comparison-baseline' && point.revision === undefined)).toBe(true);
			const gaps = measuredHistory(history, snapshots.filter(snapshot => snapshot.runId !== history.results[2].runId), historical.host, 'wago', workload.id, workload.sha256, 'steady');
			expect(gaps[2].cell.status).toBe('not-collected');
			expect(gaps).toHaveLength(8);
		}
	});
});
