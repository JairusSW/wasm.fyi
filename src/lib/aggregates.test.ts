import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregates';
import { viewCell, viewData } from './view-data';
import type { Scope } from './model';

const scope:Scope={machine:'m1',baseline:'A',hide:{},weighting:'workload'};
describe('recorded aggregate cohort',()=>{
	it('merges the successful host-local cohort across measured engines',()=>{
		const result=aggregate(scope,'lat','A',3)!;
		const applicationWorkloads=viewData.catalogue.filter(w=>w.id.startsWith('applications/'));
		const slots=viewData.applicationConfigurations.filter(slot=>applicationWorkloads.some(w=>{const c=viewCell(scope.machine,'s1',w.id,slot,'steady');return c.st==='ok'&&c.v!=null&&c.v>0;}));
		const comparable=applicationWorkloads.filter(w=>slots.every(slot=>{const c=viewCell(scope.machine,'s1',w.id,slot,'steady');return c.st==='ok'&&c.v!=null&&c.v>0;}));
		const values=comparable.map(w=>viewCell(scope.machine,'s1',w.id,'A','steady').v!);
		const usedReports=new Set(comparable.flatMap(w=>slots.map(slot=>viewCell(scope.machine,'s1',w.id,slot,'steady').report)));
		expect(result.count).toBe(comparable.length);
		expect(result.v).toBeCloseTo(Math.exp(values.reduce((a:number,v:number)=>a+Math.log(v),0)/values.length),12);
		expect(result.reports.length).toBeGreaterThan(0);
		expect(new Set(result.reports)).toEqual(usedReports);
		expect(result.r).toBe(1);
	});
	for(const machine of ['m1','m2'] as const)for(const weighting of ['workload','corpus'] as const)
    it(`excludes feature probes from first-call and steady execution averages on ${machine} with ${weighting} weighting`,async()=>{
      for(const col of [2,3]){
        const result=aggregate({...scope,machine,weighting},'lat','A',col)!;
        expect(result).not.toBeNull();
		const applicationWorkloads=viewData.catalogue.filter(workload=>workload.id.startsWith('applications/'));
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
				 expect(viewData.applicationConfigurations).toEqual(['A','B','D','E','F','G','L','M','N','O']);
    expect(Object.keys(viewData.configurations).length).toBeGreaterThan(viewData.applicationConfigurations.length);
    const result=aggregate(scope,'lat','A',3)!;
    expect(result).not.toBeNull();
    expect(viewData.applicationConfigurations.map(slot=>viewData.configurations[slot])).not.toContain('v8-wasmfx');
  });

});
