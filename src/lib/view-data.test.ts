import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALLB, BENCH, OV } from './data/snapshot';
import { benchVal, type Scope } from './model';
import { viewCell, viewData } from './view-data';
import { CFG } from './data/runtimes';
import { MET } from './data/metrics';

import preparedFeatures from '../../corpora/features/manifest.json';
import preparedApplications from '../../corpora/catalog.json';
const scope:Scope={machine:'m1',baseline:'A',hide:{},weighting:'corpus'};
describe('existing workload views consume measured evidence',()=>{
  it('places call latency alongside compilation latency',()=>{
    expect(Object.keys(OV).slice(0,3)).toEqual(['compile','calls','lat']);
    expect(OV.calls.cols).toEqual(['Wasm → host','Host → Wasm']);
  });
  for(const machine of ['m1','m2'] as const)it(`exposes both ${machine} boundary-call timings with their original units`,async()=>{
    for(const id of ['mechanisms/host-to-wasm-call','mechanisms/wasm-to-host-call']) {
      expect(ALLB.find(w=>w.id===id)?.group).toBe('Host calls');
      const cell=viewCell(machine,'s1',id,'A','steady');
      expect(cell.st).toBe('ok');
      const ref=viewData.reports[cell.report];
      const raw=JSON.parse(await readFile(new URL('../../data/wasmbench/'+ref.evidence,import.meta.url),'utf8'));
      const summary=raw.summaries.find((s:any)=>s.runtime==='wasmtime'&&s.workload===id&&s.scenario==='steady'&&s.profile==='timing');
      expect(cell.v).toBe(summary.median_ns_per_operation/1e6);
    }
  });
	it('groups applications by operation and places every feature group last',()=>{
		const applications=ALLB.filter(w=>!w.id.startsWith('features/')&&!w.id.startsWith('mechanisms/'));
		expect(applications).toHaveLength(166);
		expect(new Set(applications.map(w=>w.group)).size).toBe(27);
        for(const group of new Set(applications.map(w=>w.group))) {
          const count=applications.filter(w=>w.group===group).length;
          expect(count).toBeGreaterThanOrEqual(6);expect(count).toBeLessThanOrEqual(9);
        }
        expect(applications.some(w=>/^applications\/.+\/\d+$/.test(w.id))).toBe(false);
        expect(applications.some(w=>w.id==='wago/json-as/serializeN')).toBe(false);
		expect(BENCH.some(g=>g.g.includes('Wago'))).toBe(false);
		for(const catalogue of [viewData.catalogue,ALLB]) {
			const firstFeature=catalogue.findIndex(w=>w.id.startsWith('features/'));
			expect(firstFeature).toBe(applications.length+2);
			expect(catalogue.slice(firstFeature).every(w=>w.id.startsWith('features/'))).toBe(true);
		}
		for(const [id,group] of [
			['wago/json-as-simd/serializeN','JSON & serialization'],
			['wago/lz4/compress','Compression'],
			['wago/polybench-gemm/polybench_run','Linear algebra'],
			['wago/polybench-jacobi-2d/polybench_run','Stencils'],
			['wago/drwav/pcm-decode-seek','Audio'],
			['wago/raytrace/render','3D & rendering'],
			['wago/utf-as-simd/validateN','Text & parsing']
		])expect(applications.find(w=>w.id===id)?.group).toBe(group);
	});
	it('prepared image, 3D and inference workloads show only measured metrics',()=>{
    for(const id of ['applications/image-blur','applications/mesh-skinning','applications/ml-inference']) {
      expect(ALLB.find(w=>w.id===id)?.ms).toBeGreaterThan(0);
      for(const machine of ['m1','m2'] as const){const cell=viewCell(machine,'s1',id,'A','steady');expect(cell.st).toBe('ok');expect(cell.report).toMatch(/^[a-f0-9]{64}$/);}
    }
  });
	it('uses exact workload identifiers and independent artifact digests',()=>{
		expect(ALLB).toHaveLength(preparedApplications.workloads.length+preparedFeatures.length+2);
        const prepared=new Map([...preparedApplications.workloads.map(w=>[w.contractId,w.sha256] as const),...preparedFeatures.map(w=>[w.id,w.sha256] as const)]);
        for(const w of ALLB.filter(w=>!w.id.startsWith('mechanisms/')))expect(w.artifactSha256).toBe(prepared.get(w.id));
		expect(new Set(ALLB.map(b=>b.id)).size).toBe(ALLB.length);
		for(const b of ALLB)expect(b.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(ALLB.some(b=>b.id==='sqlite-speedtest1')).toBe(false);
	});
	it('lists every benchmarked engine configuration on the Benchmarks page',()=>{
		expect(CFG.map(config=>config.id)).toEqual(Object.keys(viewData.configurations).filter(id=>id!=='S'));
		expect(viewData.configurations).not.toHaveProperty('C');
		expect(CFG.find(config=>config.id==='Q')?.be).toBe('interpreter');
		expect(viewData.configurations.Q).toBe('wazero-interpreter');
		expect(CFG.find(config=>config.id==='F')?.be).toBe('production-default-tiering');
		expect(CFG.some(config=>config.id==='H')).toBe(false);
		expect(viewData.configurations.F).toBe('v8');
		expect(viewData.applicationConfigurations).toEqual(['A','B','D','E','F','G','L','M','N','O']);
		for(const id of ['I','K','M','N','O','P'] as const)
			expect(viewData.hosts.m1.configurations[id]||viewData.hosts.m2.configurations[id]).toBeDefined();
	});
	it('orders workload metrics with phase-matched RSS before first and steady calls',()=>{
		expect(Object.keys(MET)).toEqual(['compile','rssCompile','inst','rssInst','first','steady','rss','code']);
		for(const machine of ['m1','m2'] as const) {
			for(const metric of ['rssCompile','rssInst'] as const) {
				const cell=viewCell(machine,'s1','wago/tiny/add','A',metric);
				expect(cell.st).toBe('ok');
				expect(cell.v).toBeGreaterThan(0);
				const report=viewData.reports[cell.report];
				expect(report?.memorySource?.id).toMatch(/^memory-/);
			}
		}
	});
	for(const machine of ['m1','m2'] as const)it(`matches ${machine} rendered cell units to the sealed summary`,async()=>{
		const b=ALLB.find(b=>b.id==='wago/tiny/add')!;
		const cell=viewCell(machine,'s1',b.id,'D','steady');
		const ref=viewData.reports[cell.report];
		const raw=JSON.parse(await readFile(new URL('../../data/wasmbench/'+ref.evidence,import.meta.url),'utf8'));
		const summary=raw.summaries.find((s:any)=>s.runtime==='wasmer-singlepass'&&s.workload===b.id&&s.scenario==='steady'&&s.profile==='timing');
		expect(cell.st).toBe('ok');
		expect(cell.v).toBe(summary.median_ns_per_operation/1e6);
		if (Number.isFinite(summary.ci95_low) && Number.isFinite(summary.ci95_high))
			expect(cell.interval).toEqual([summary.ci95_low/1e6,summary.ci95_high/1e6]);
		else expect(cell.interval).toBeUndefined();
		expect(benchVal({...scope,machine},b,'D','steady')).toEqual({st:'ok',v:cell.v});
	});
	it('preserves explicit unsupported and unavailable cells without old-success fallback',()=>{
		const b=ALLB.find(b=>b.id==='features/simd/i32x4-add-multiply/64')!;
		expect(benchVal(scope,b,'D','steady')).toEqual({st:'unsupported'});
		expect(benchVal({...scope,snapshot:'s2'},b,'D','steady')).toEqual({st:viewCell('m1','s2',b.id,'D','steady').st});
		expect(benchVal(scope,{...b,id:'uncollected/input'},'A','steady')).toEqual({st:'nm'});
	});
});


it('history retains frozen artifact identities when the current corpus is rebuilt',async()=>{
  const root=new URL('../../data/history/',import.meta.url);
  const weekly=JSON.parse(await readFile(new URL('weekly.json',root),'utf8'));
  const index=JSON.parse(await readFile(new URL('index.json',root),'utf8'));
  const entry=index.reports.find((r:{id:string})=>r.id===weekly.baseline.report);
  const baseline=JSON.parse(await readFile(new URL(entry.projection,root),'utf8'));
  for(const id of viewData.history.m2.workloads)
    expect(viewData.history.m2.artifactSha256[id]).toBe(baseline.workloads.find((w:{id:string})=>w.id===id).sha256);
  const id='wago/nbody/step';
  expect(viewData.history.m2.artifactSha256[id]).not.toBe(ALLB.find(w=>w.id===id)?.artifactSha256);
});


it('preserves measured source workload results and unsupported engine outcomes',()=>{
  const b=ALLB.find(b=>b.id==='wago/json-as-simd/serializeN')!;
  expect(benchVal(scope,b,'D','steady')).toEqual({st:'unsupported'});
  expect(b.ms).toBeGreaterThan(0);
});
