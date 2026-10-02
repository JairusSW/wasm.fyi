import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALLB, BENCH } from './data/snapshot';
import { benchVal, type Scope } from './model';
import { viewCell, viewData } from './view-data';

const scope:Scope={machine:'m1',baseline:'A',hide:{},weighting:'corpus'};
describe('existing workload views consume measured evidence',()=>{
	it('groups applications by operation and places every feature group last',()=>{
		const applications=ALLB.filter(w=>!w.id.startsWith('features/'));
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
			expect(firstFeature).toBe(applications.length);
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
	it('prepared image, 3D and inference workloads have no invented metrics',()=>{
    for(const id of ['applications/image-blur','applications/mesh-skinning','applications/ml-inference']) {
      expect(ALLB.find(w=>w.id===id)?.ms).toBeNull();
      for(const machine of ['m1','m2'] as const)expect(viewCell(machine,'s1',id,'A','steady')).toEqual({st:'nm',report:''});
    }
  });
	it('uses exact workload identifiers and independent artifact digests',()=>{
		expect(ALLB).toHaveLength(398);
		expect(new Set(ALLB.map(b=>b.id)).size).toBe(ALLB.length);
		for(const b of ALLB)expect(b.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(ALLB.some(b=>b.id==='sqlite-speedtest1')).toBe(false);
	});
	for(const machine of ['m1','m2'] as const)it(`matches ${machine} rendered cell units to the sealed summary`,async()=>{
		const b=ALLB.find(b=>b.id==='wago/tiny/add')!;
		const cell=viewCell(machine,'s1',b.id,'C','steady');
		const ref=viewData.reports[cell.report];
		const raw=JSON.parse(await readFile(new URL('../../data/wasmbench/'+ref.evidence,import.meta.url),'utf8'));
		const summary=raw.summaries.find((s:any)=>s.runtime==='wasmer-llvm'&&s.workload===b.id&&s.scenario==='steady'&&s.profile==='timing');
		expect(cell.st).toBe('ok');
		expect(cell.v).toBe(summary.median_ns_per_operation/1e6);
		expect(cell.interval).toEqual([summary.ci95_low/1e6,summary.ci95_high/1e6]);
		expect(benchVal({...scope,machine},b,'C','steady')).toEqual({st:'ok',v:cell.v});
	});
	it('preserves explicit unsupported and unavailable cells without old-success fallback',()=>{
		const b=ALLB.find(b=>b.id==='wago/json-as-simd/serializeN')!;
		expect(benchVal(scope,b,'D','steady')).toEqual({st:'unsupported'});
		expect(benchVal({...scope,snapshot:'s2'},b,'D','steady')).toEqual({st:viewCell('m1','s2',b.id,'D','steady').st});
		expect(benchVal(scope,{...b,id:'uncollected/input'},'A','steady')).toEqual({st:'nm'});
	});
});
