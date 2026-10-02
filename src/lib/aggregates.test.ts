import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregates';
import { viewCell, viewData } from './view-data';
import type { Scope } from './model';

const scope:Scope={machine:'m1',baseline:'A',hide:{},weighting:'workload'};
describe('recorded aggregate cohort',()=>{
	it('matches the successful shared cohort and mean in its authoritative report',async()=>{
		const result=aggregate(scope,'lat','A',3)!;
		const reference=viewData.reports[result.report];
		const raw=JSON.parse(await readFile(new URL('../../data/wasmbench/'+reference.evidence,import.meta.url),'utf8'));
		const runtimes=viewData.applicationConfigurations.map(id=>viewData.configurations[id]);
		const eligible=raw.workloads.filter((w:any)=>!w.id.startsWith('features/') && viewData.catalogue.some(b=>b.id===w.id && b.artifactSha256===w.sha256) && runtimes.every(runtime=>{
			const s=raw.summaries.find((s:any)=>s.runtime===runtime && s.workload===w.id && s.scenario==='steady' && s.profile==='timing');
			return s?.outcomes.ok>0 && s.median_ns_per_operation>0 && Object.entries(s.outcomes).every(([status,n])=>status==='ok'||status==='unsupported'||n===0);
		}));
		const slots=viewData.applicationConfigurations.filter(slot=>runtimes.includes(viewData.configurations[slot]));
		const comparable=eligible.filter((w:any)=>slots.every(slot=>{const cell=viewCell(scope.machine,'s1',w.id,slot,'steady');return cell.report===result.report && cell.st==='ok';}));
		const values=comparable.map((w:any)=>raw.summaries.find((s:any)=>s.runtime==='wasmtime'&&s.workload===w.id&&s.scenario==='steady'&&s.profile==='timing').median_ns_per_operation/1e6);
		expect(result.count).toBe(comparable.length);
		expect(result.v).toBeCloseTo(Math.exp(values.reduce((a:number,v:number)=>a+Math.log(v),0)/values.length),12);
		expect(result.r).toBe(1);
		expect(result.ratioInterval).toEqual([1,1]);
		expect(result.interval![0]).toBeGreaterThan(0);
	});
	for(const machine of ['m1','m2'] as const)for(const weighting of ['workload','corpus'] as const)
    it(`excludes feature probes from first-call and steady execution averages on ${machine} with ${weighting} weighting`,async()=>{
      for(const col of [2,3]){
        const result=aggregate({...scope,machine,weighting},'lat','A',col)!;
        expect(result).not.toBeNull();
        const applicationWorkloads=viewData.catalogue.filter(workload=>!workload.id.startsWith('features/'));
        expect(applicationWorkloads.every(workload=>!workload.id.startsWith('features/'))).toBe(true);
        expect(result.count).toBeGreaterThan(0);
        expect(result.count).toBeLessThanOrEqual(applicationWorkloads.length);
      }
    });
	it('does not invent phase deltas, retained memory or native code breakdowns',()=>{
		expect(aggregate(scope,'mem','A',3)).toBeNull();
		expect(aggregate(scope,'code','A',0)).toBeNull();
		expect(aggregate(scope,'code','A',4)).toBeNull();
		expect(aggregate(scope,'code','C',3)).toBeNull();
	});
	it('never substitutes another baseline for an unavailable collector',()=>{
		const result=aggregate({...scope,baseline:'C'},'code','A',3);
		expect(result?.v).toBeGreaterThan(0);
		expect(Number.isNaN(result?.r)).toBe(true);
		expect(result?.ratioInterval).toBeUndefined();
	});
  it('keeps feature-only configurations outside application and history comparison cohorts',()=>{
    expect(viewData.applicationConfigurations).toEqual(['A','B','C','D','E','G']);
    expect(Object.keys(viewData.configurations).length).toBeGreaterThan(viewData.applicationConfigurations.length);
    const result=aggregate(scope,'lat','A',3)!;
    expect(result).not.toBeNull();
    expect(viewData.applicationConfigurations.map(slot=>viewData.configurations[slot])).not.toContain('wasmedge');
  });

});
