import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALLB, BENCH, OV } from './data/snapshot';
import { benchVal, type Scope } from './model';
import { viewCell, viewData } from './view-data';
import { CFG } from './data/runtimes';
import { MET } from './data/metrics';

import preparedFeatures from '../../corpora/features/manifest.json';
import preparedApplications from '../../corpora/catalog.json';
const scope:Scope={machine:'m1',baseline:'G',hide:{},weighting:'corpus'};
describe('existing workload views consume measured evidence',()=>{
  it('places call latency alongside the original latency tab',()=>{
    expect(Object.keys(OV).slice(0,2)).toEqual(['lat','calls']);
    expect(OV.calls.cols).toEqual(['Wasm → host → Wasm','Host → Wasm → host']);
  });
  for(const machine of ['m1','m2'] as const)it(`exposes both ${machine} boundary-call timings with their original units`,async()=>{
    for(const id of ['mechanisms/host-to-wasm-call','mechanisms/wasm-to-host-call']) {
      expect(ALLB.find(w=>w.id===id)?.group).toBe('Host calls');
      const cell=viewCell(machine,'s1',id,'G','steady');
      expect(cell.st).toBe('ok');
      const ref=viewData.reports[cell.report];
      const raw=JSON.parse(await readFile(new URL('../../data/wasmbench/'+ref.evidence,import.meta.url),'utf8'));
      const summary=raw.summaries.find((s:any)=>s.runtime==='wago'&&s.workload===id&&s.scenario==='steady'&&s.profile==='timing');
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
			expect(firstFeature).toBe(-1);
			expect(catalogue.filter(w=>w.id.startsWith('features/'))).toHaveLength(0);
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
      const baselines=(['m1','m2'] as const).map(machine=>viewCell(machine,'s1',id,'A','steady')).filter(cell=>cell.st==='ok');
      expect(baselines.length?baselines.map(cell=>cell.v):[null]).toContain(ALLB.find(w=>w.id===id)?.ms);
      for(const machine of ['m1','m2'] as const){const cell=viewCell(machine,'s1',id,'G','steady');expect(cell.st).toBe('ok');expect(cell.report).toMatch(/^[a-f0-9]{64}$/);}
    }
  });
	it('uses exact workload identifiers and independent artifact digests',()=>{
		expect(ALLB).toHaveLength(preparedApplications.workloads.length+2);
        const prepared=new Map([...preparedApplications.workloads.map(w=>[w.contractId,w.sha256] as const),...preparedFeatures.map(w=>[w.id,w.sha256] as const)]);
        for(const w of ALLB.filter(w=>!w.id.startsWith('mechanisms/')))expect(w.artifactSha256).toBe(prepared.get(w.id));
		expect(new Set(ALLB.map(b=>b.id)).size).toBe(ALLB.length);
		for(const b of ALLB)expect(b.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(ALLB.some(b=>b.id==='sqlite-speedtest1')).toBe(false);
	});
	it('lists only the six supported benchmark configurations',()=>{
        expect(CFG.map(config=>config.id)).toEqual(['A','D','E','F','G','L','T','U']);
        expect(Object.keys(viewData.configurations)).toEqual(['A','D','E','F','G','L','T','U']);
        expect(viewData.applicationConfigurations).toContain('G');
        expect(viewData.applicationConfigurations.every(slot=>CFG.some(config=>config.id===slot))).toBe(true);
        expect(CFG.find(config=>config.id==='A')?.be).toBe('cranelift');
        expect(CFG.find(config=>config.id==='D')?.be).toMatch(/^singlepass/);
    });
	it('orders workload metrics with phase-matched RSS before first and steady calls',()=>{
		expect(Object.keys(MET)).toEqual(['compile','rssCompile','inst','rssInst','first','steady','rss','code']);
		for(const machine of ['m1','m2'] as const) {
			for(const metric of ['rssCompile','rssInst'] as const) {
				const cell=viewCell(machine,'s1','wago/tiny/add','G',metric);
				expect(cell.st).toBe('ok');
				expect(cell.v).toBeGreaterThan(0);
				const report=viewData.reports[cell.report];
				expect(report?.memorySource?.id).toMatch(/memory(?:-|$)/);
			}
		}
	});
	for(const machine of ['m1','m2'] as const)it(`matches ${machine} rendered cell units to the sealed summary`,async()=>{
		const b=ALLB.find(b=>b.id==='wago/tiny/add')!;
		const cell=viewCell(machine,'s1',b.id,'G','steady');
		const ref=viewData.reports[cell.report];
		const raw=JSON.parse(await readFile(new URL('../../data/wasmbench/'+ref.evidence,import.meta.url),'utf8'));
		const summary=raw.summaries.find((s:any)=>s.runtime==='wago'&&s.workload===b.id&&s.scenario==='steady'&&s.profile==='timing');
		expect(cell.st).toBe('ok');
		expect(cell.v).toBe(summary.median_ns_per_operation/1e6);
		if (Number.isFinite(summary.ci95_low) && Number.isFinite(summary.ci95_high))
			expect(cell.interval).toEqual([summary.ci95_low/1e6,summary.ci95_high/1e6]);
		else expect(cell.interval).toBeUndefined();
		expect(benchVal({...scope,machine},b,'G','steady')).toEqual({st:'ok',v:cell.v});
	});
	it('leaves uncollected engines and contracts unmeasured',()=>{
        const b=ALLB.find(b=>b.id==='applications/image-blur')!;
        expect(benchVal(scope,b,'C','steady')).toEqual({st:'nm'});
        expect(benchVal(scope,{...b,id:'uncollected/input'},'G','steady')).toEqual({st:'nm'});
    });
});


it('history retains the exact pinned corpus shard digests',async()=>{
 const root=new URL('../../data/history/',import.meta.url);
 const index=JSON.parse(await readFile(new URL('index.json',root),'utf8'));
 const reports=await Promise.all(index.reports.map(async(r:any)=>JSON.parse(await readFile(new URL(r.projection,root),'utf8'))));
 const artifacts=new Set(reports.flatMap(r=>r.workloads.map((w:any)=>`${w.id}|${w.sha256}`)));
 for(const id of viewData.history.m2.workloads)expect(artifacts.has(`${id}|${viewData.history.m2.artifactSha256[id]}`)).toBe(true);
},30000);
