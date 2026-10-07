import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadMeasuredSnapshot, measuredCodeImage, measuredHistory, measuredMemory, measuredTiming, type MeasuredSnapshot, type MeasuredWeeklyHistory, type SnapshotEntry } from './measured';

const root = new URL('../../data/', import.meta.url);
async function store(name: string) {
	const index = JSON.parse(await readFile(new URL(name + '/index.json', root), 'utf8')) as { reports: SnapshotEntry[] };
	// Historical stores contain tens of thousands of projections. Bound pending
	// reads instead of opening the entire archive at once on shared CI runners.
	const snapshots: MeasuredSnapshot[] = [];
	for (let offset = 0; offset < index.reports.length; offset += 64) {
		snapshots.push(...await Promise.all(index.reports.slice(offset, offset + 64).map(async entry =>
			JSON.parse(await readFile(new URL(name + '/' + entry.projection, root), 'utf8')) as MeasuredSnapshot)));
	}
	return { index, snapshots };
}
const { index, snapshots } = await store('wasmbench');
// Controlled fixtures exercise collector rules independently of the deployed engines.
const item={id:'features/core-num/integer-multiply-add/1',sha256:'a'.repeat(64),work_unit:'call',units_per_invocation:1};
const ids=['wasmtime','wazero','v8-optimizing-only','wago'];
const feature:MeasuredSnapshot={id:'fixture',runId:'fixture-run',created:'2026-10-04T12:00:00Z',sourceReportSha256:'b'.repeat(64),host:{hostname:'fixture',os:'linux',arch:'amd64'},options:{launches:3},evidence:'fixture.json',evidenceSha256:'c'.repeat(64),
 runtimes:ids.map(id=>({id,file_sha256:{},description:{runtime:id,runtime_version:'1.0.0',backend:'compiler',effective_configuration:id==='wazero'?{compile_policy:'fresh uncached module per operation; verification outside timer'}:{flags:JSON.stringify(['--no-wasm-native-module-cache'])}}})),
 workloads:[item,{...item,id:'features/cm-async/future-stream-compile/1'}],
 summaries:ids.flatMap(runtime=>['compile','instantiate','first-call','steady'].map(scenario=>({runtime,workload:item.id,scenario,profile:'timing',outcomes:{ok:3},latency_status:'timing_pass',median_ns_per_operation:100,independent_launches:3,sample_count:6}))),
 memorySource:{id:'memory-fixture',note:'fixture'},codeSource:{id:'code-fixture',note:'fixture'},
 memory:ids.flatMap(runtime=>['compile','steady'].flatMap(scenario=>['host.js_heap.end','process.peak_rss'].map(metric=>({runtime,workload:item.id,scenario,metric,median_bytes:4096,independent_launches:3})))),
 codeRecords:ids.filter(id=>id!=='wazero').map(runtime=>({runtime,workload:item.id,status:'available',image_bytes:100}))};

describe('measured view boundary', () => {
	it('reads actual host-specific timing and keeps engine IDs distinct from preview slots', () => {
		const summary = feature.summaries.find(summary => summary.runtime === 'wasmtime' && summary.workload === item.id && summary.scenario === 'steady')!;
		const cell = measuredTiming(feature, 'wasmtime', item.id, item.sha256, 'steady');
		expect(cell.status).toBe('ok');
		if (cell.status === 'ok') { expect(cell.value).toBe(summary.median_ns_per_operation); expect(cell.unit).toBe('ns/invocation'); expect(cell.evidence.runId).toBe(feature.runId); }
		expect(measuredTiming(feature, 'A', item.id, item.sha256, 'steady').status).toBe('not-collected');
		expect(measuredTiming(feature, 'wasmtime', item.id, '0'.repeat(64), 'steady').status).toBe('not-collected');
	});

	it('withholds unaudited compile cache hits while preserving execution evidence', () => {
		for (const runtime of ['wazero', 'v8-optimizing-only']) {
			const copy = structuredClone(feature);
			const config = copy.runtimes.find(r => r.id === runtime)!;
			config.description.effective_configuration = {};
			expect(measuredTiming(copy, runtime, item.id, item.sha256, 'compile').status).toBe('not-measured');
			expect(measuredTiming(copy, runtime, item.id, item.sha256, 'steady').status).toBe('ok');
			config.description.effective_configuration = runtime === 'wazero'
				? {compile_policy: 'fresh uncached module per operation; verification outside timer'}
				: {flags: JSON.stringify(['--no-wasm-native-module-cache'])};
			expect(measuredTiming(copy, runtime, item.id, item.sha256, 'compile').status).toBe('ok');
		}
	});

	it('withholds mixed successful and failed launches rather than averaging them', () => {
		const copy = structuredClone(feature);
		const summary = copy.summaries.find(summary => summary.runtime === 'wasmtime' && summary.workload === item.id && summary.scenario === 'steady')!;
		summary.outcomes = { ok: 2, preflight_failed: 1 };
		expect(measuredTiming(copy, 'wasmtime', item.id, item.sha256, 'steady').status).toBe('failed');
		expect(measuredMemory(copy, 'wasmtime', item.id, item.sha256, 'steady', 'host.js_heap.end').status).toBe('failed');
	});

	it('does not publish zero-duration samples as valid latency', () => {
		const copy = structuredClone(feature);
		const summary = copy.summaries.find(summary => summary.runtime === 'wasmtime' && summary.workload === item.id && summary.scenario === 'steady')!;
		summary.median_ns_per_operation = 0;
		expect(measuredTiming(copy, 'wasmtime', item.id, item.sha256, 'steady')).toMatchObject({
			status: 'not-measured', reason: 'The operation completed below the timing clock resolution.'
		});
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
		expect(feature.runtimes.some(runtime => runtime.id === 'wasmtime-component-async')).toBe(false);
		expect(measuredTiming(feature, 'wasmtime-component-async', async.id, async.sha256, 'compile').status).toBe('not-collected');
	});

	it('exposes code images as images and rejects conflicting sizes', () => {
		const cell = measuredCodeImage(feature, 'wasmtime', item.id, item.sha256);
		expect(cell.status).toBe('ok');
		const copy = structuredClone(feature);
		const record = copy.codeRecords.find(record => record.runtime === 'wasmtime' && record.workload === item.id)!;
		copy.codeRecords.push({ ...record, image_bytes: record.image_bytes! + 1 });
		expect(measuredCodeImage(copy, 'wasmtime', item.id, item.sha256).status).toBe('not-measured');
	});

	it('marks interpreter code as not applicable and keeps native collector limits visible', () => {
		const interp = structuredClone(feature);
		const wago = interp.runtimes.find(runtime => runtime.id === 'wago')!;
		wago.description.backend = 'interpreter';
		expect(measuredCodeImage(interp, 'wago', item.id, item.sha256)).toMatchObject({status: 'not-applicable'});
		const compiler = structuredClone(feature);
		compiler.codeRecords.push({runtime: 'wazero', workload: item.id, status: 'unsupported', reason: 'public embedding API does not export function code'});
		expect(measuredCodeImage(compiler, 'wazero', item.id, item.sha256)).toMatchObject({status: 'not-measured', reason: 'public embedding API does not export function code'});
	});
	it('shows verified native size independently from byte export',()=>{
		const copy=structuredClone(feature);
		copy.codeRecords=copy.codeRecords.filter(record=>record.runtime!=='wasmtime'||record.workload!==item.id);
		copy.codeRecords.push({runtime:'wasmtime',workload:item.id,status:'unavailable',image_bytes:undefined,size_bytes:114175248,reason:'native segment exceeds transport budget'});
		expect(measuredCodeImage(copy,'wasmtime',item.id,item.sha256)).toMatchObject({status:'ok',value:114175248,unit:'bytes'});
		copy.codeRecords[copy.codeRecords.length-1].size_bytes=undefined;
		expect(measuredCodeImage(copy,'wasmtime',item.id,item.sha256).status).toBe('not-measured');
	});

	it('keeps timing-only snapshots from inventing memory or native-code results',()=>{
		const latest=structuredClone(feature);
		latest.memory=[];latest.codeRecords=[];latest.memorySource=undefined;latest.codeSource=undefined;
		expect(latest.memory).toHaveLength(0);expect(latest.codeRecords).toHaveLength(0);
		expect(measuredMemory(latest,'wasmtime',item.id,item.sha256,'steady','process.peak_rss').status).toBe('not-collected');
		expect(measuredCodeImage(latest,'wasmtime',item.id,item.sha256).status).toBe('not-collected');
	});

	it('checks deployed projection bytes, metadata and hosted base paths', async () => {
		const entry = index.reports[0];
		const bytes = await readFile(new URL('wasmbench/' + entry.projection, root), 'utf8');
		const fetcher = (async (path: string) => { expect(path).toBe('/wasm.fyi/wasmbench/' + entry.projection); return new Response(bytes); }) as typeof fetch;
		expect((await loadMeasuredSnapshot('/wasm.fyi/wasmbench/', entry, fetcher)).id).toBe(entry.id);
		await expect(loadMeasuredSnapshot('/wasm.fyi/wasmbench', entry, (async () => new Response(bytes + ' ')) as typeof fetch)).rejects.toThrow('checksum');
		await expect(loadMeasuredSnapshot('/wasm.fyi/wasmbench', { ...entry, host: { ...entry.host, hostname: 'wrong-host' } }, fetcher)).rejects.toThrow('metadata');
	});

	// Keep each host independently timed and reported; full archive I/O is an
	// integration check, not a 30-second budget shared by both historical hosts.
	it.each(['history', 'history-hub'])('reads each pinned historical point in %s and retains shard provenance and gaps', async (name) => {
		const { snapshots } = await store(name);
		const history = JSON.parse(await readFile(new URL(name + '/weekly.json', root), 'utf8')) as MeasuredWeeklyHistory;
		const first=history.results.findIndex(point=>point.engines?.wago?.reports?.length || (!point.engines && (point.reports?.length || point.runId)));
		expect(first).toBeGreaterThanOrEqual(0);
		const source=history.results[first];
		const receipts=source.engines?.wago?.reports||source.reports||[source];
		const historical=snapshots.find(snapshot=>receipts.some(pin=>pin.runId===snapshot.runId)&&snapshot.workloads.some(w=>w.id==='applications/image-blur'))!;
		const workload=historical.workloads.find(w=>w.id==='applications/image-blur')!;
		const cells = measuredHistory(history, snapshots, historical.host, 'wago', workload.id, workload.sha256, 'steady');
		expect(cells).toHaveLength(history.results.length);
		for(const [i,point] of cells.entries()){
                expect(point.role).toBe('retrospective-revision');
                const week=history.results[i];
                const pin=week.engines ? week.engines.wago : week;
                const refs=pin?.reports || (pin ? [pin] : []);
                const report=snapshots.filter(snapshot=>refs.some(ref=>ref.runId===snapshot.runId)
                    && snapshot.workloads.some(w=>w.id===workload.id && w.sha256===workload.sha256)
                    && snapshot.summaries.some(summary=>summary.runtime==='wago' && summary.workload===workload.id && summary.scenario==='steady'))
                    .sort((a,b)=>b.created.localeCompare(a.created))[0];
                if(week.status==='measured' && pin?.status==='measured' && report){
                    expect(point.cell).toEqual(measuredTiming(report,'wago',workload.id,workload.sha256,'steady'));
                }else{
                    expect(point.cell.status,`${name} ${week.targetWeek}: absent workload stays uncollected`).toBe('not-collected');
                }
            }
		const baseline = measuredHistory(history, snapshots, historical.host, 'wasmtime', workload.id, workload.sha256, 'steady');
		for(const [i,point] of baseline.entries()){
                expect(point.role).toBe(history.results[i].engines?'retrospective-revision':'fixed-comparison-baseline');
                expect(point.revision).toBe(history.results[i].engines?.wasmtime?.revision);
            }
		const gaps = measuredHistory(history, snapshots.filter(snapshot => snapshot.runId !== historical.runId), historical.host, 'wago', workload.id, workload.sha256, 'steady');
		expect(gaps[first].cell.status).toBe('not-collected');
		expect(gaps).toHaveLength(history.results.length);
	}, 120_000);
});

it('resolves historical corpus shards independently and rejects a changed receipt',()=>{
 const a=structuredClone(feature),b=structuredClone(feature);
 a.runId='history-a';a.id='history-a';b.runId='history-b';b.id='history-b';
 b.workloads[0].id='applications/second';
 for(const summary of b.summaries)summary.workload='applications/second';
 const history:MeasuredWeeklyHistory={baseline:{report:a.id,reports:[a.id,b.id]},results:[{targetWeek:'2026-10-03T23:59:00-04:00',revision:'d'.repeat(40),status:'measured',reports:[a,b].map(s=>({runId:s.runId,collectedAt:s.created,reportSha256:s.sourceReportSha256!}))}]};
 expect(measuredHistory(history,[a,b],a.host,'wago',item.id,item.sha256,'steady')[0].cell).toMatchObject({status:'ok',evidence:{report:a.id}});
 expect(measuredHistory(history,[a,b],a.host,'wago',b.workloads[0].id,item.sha256,'steady')[0].cell).toMatchObject({status:'ok',evidence:{report:b.id}});
 expect(measuredHistory(history,[a],a.host,'wago',b.workloads[0].id,item.sha256,'steady')[0].cell.status).toBe('not-collected');
 history.results[0].reports![1].reportSha256='changed';
 expect(()=>measuredHistory(history,[a,b],a.host,'wago',b.workloads[0].id,item.sha256,'steady')).toThrow('weekly manifest');
});

it('uses each engine’s pinned weekly report and keeps missing engine snapshots as gaps',()=>{
 const historical=structuredClone(feature);historical.id='weekly-wasmtime';historical.runId='weekly-wasmtime-run';
 historical.summaries.forEach(summary=>{summary.median_ns_per_operation=180;});
 const pin={revision:'e'.repeat(40),status:'measured',reports:[{runId:historical.runId,collectedAt:historical.created,reportSha256:historical.sourceReportSha256!}]};
 const history:MeasuredWeeklyHistory={baseline:{report:feature.id},results:[{targetWeek:'2026-10-03T23:59:00-04:00',revision:'d'.repeat(40),status:'measured',engines:{wasmtime:pin}}]};
 const point=measuredHistory(history,[feature,historical],feature.host,'wasmtime',item.id,item.sha256,'steady')[0];
 expect(point).toMatchObject({role:'retrospective-revision',revision:pin.revision,cell:{status:'ok',value:180,evidence:{report:historical.id}}});
 expect(measuredHistory(history,[feature,historical],feature.host,'wazero',item.id,item.sha256,'steady')[0].cell.status).toBe('not-collected');
 pin.reports[0].reportSha256='changed';
 expect(()=>measuredHistory(history,[feature,historical],feature.host,'wasmtime',item.id,item.sha256,'steady')).toThrow('weekly manifest');
});

it('selects the newest pinned call report independently of receipt order',()=>{
 const old=structuredClone(feature),precise=structuredClone(feature);
 precise.id='million-operation-call';precise.runId=precise.id;precise.created='2026-10-04T12:01:00Z';
 precise.summaries.forEach(row=>{row.median_ns_per_operation=9;});
 const receipts=[old,precise].map(s=>({runId:s.runId,collectedAt:s.created,reportSha256:s.sourceReportSha256}));
 const history:MeasuredWeeklyHistory={baseline:{report:old.id},results:[{targetWeek:'2026-10-03',revision:'a'.repeat(40),status:'measured',engines:{wasmtime:{revision:'a'.repeat(40),status:'measured',reports:receipts}}}]};
 expect(measuredHistory(history,[old,precise],old.host,'wasmtime',item.id,item.sha256,'steady')[0].cell).toMatchObject({status:'ok',value:9,evidence:{report:precise.id}});
 precise.summaries.forEach(row=>{row.outcomes={preflight_failed:3};row.median_ns_per_operation=null;});
 expect(measuredHistory(history,[old,precise],old.host,'wasmtime',item.id,item.sha256,'steady')[0].cell.status).toBe('failed');
});
