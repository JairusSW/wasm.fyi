import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregates';
import { viewCell, viewData } from './view-data';
import { leader, sharedCount, type Scope } from './model';

const scope:Scope={machine:'m1',baseline:'G',hide:{},weighting:'workload'};
describe('recorded aggregate cohort',()=>{
 it('keeps successful values per engine and requires every engine in shared mode',()=>{
  const independent=aggregate({...scope,baseline:'C',cohortMode:'per-engine'},'code','G',3);
  expect(independent?.v).toBeGreaterThan(0);
  expect(Number.isNaN(independent?.r)).toBe(true);
  expect(aggregate({...scope,baseline:'C',cohortMode:'shared'},'code','G',3)).toBeNull();
 });
	it('merges the successful host-local cohort across measured engines',()=>{
		const result=aggregate(scope,'lat','G',3)!;
		const nonFeatureWorkloads=viewData.catalogue.filter(w=>!w.id.startsWith('features/'));
		const slots=viewData.applicationConfigurations.filter(slot=>nonFeatureWorkloads.some(w=>{const c=viewCell(scope.machine,'s1',w.id,slot,'steady');return c.st==='ok'&&c.v!=null&&c.v>0;}));
		const comparable=nonFeatureWorkloads.filter(w=>slots.every(slot=>{const c=viewCell(scope.machine,'s1',w.id,slot,'steady');return c.st==='ok'&&c.v!=null&&c.v>0;}));
		const values=comparable.map(w=>viewCell(scope.machine,'s1',w.id,'G','steady').v!);
		const usedReports=new Set(comparable.flatMap(w=>slots.map(slot=>viewCell(scope.machine,'s1',w.id,slot,'steady').report)));
		expect(result.count).toBe(comparable.length);
		expect(sharedCount(scope)).toBe(comparable.length);
		expect(result.v).toBeCloseTo(Math.exp(values.reduce((a:number,v:number)=>a+Math.log(v),0)/values.length),12);
		expect(result.reports.length).toBeGreaterThan(0);
		expect(new Set(result.reports)).toEqual(usedReports);
		expect(result.r).toBe(1);
	});
	for(const machine of ['m1','m2'] as const)for(const weighting of ['workload','corpus'] as const)
    it(`excludes feature probes from all non-feature first-call and steady execution averages on ${machine} with ${weighting} weighting`,async()=>{
      for(const col of [2,3]){
        const result=aggregate({...scope,machine,weighting},'lat','G',col)!;
        expect(result).not.toBeNull();
		const nonFeatureWorkloads=viewData.catalogue.filter(workload=>!workload.id.startsWith('features/'));
		expect(nonFeatureWorkloads.every(workload=>!workload.id.startsWith('features/'))).toBe(true);
        expect(result.count).toBeGreaterThan(0);
        expect(result.count).toBeLessThanOrEqual(nonFeatureWorkloads.length);
      }
    });
	for(const machine of ['m1','m2'] as const)it(`reports the arithmetic mean of non-peak process RSS across lifecycle workloads on ${machine}`,()=>{
		const cells=Object.entries(viewData.hosts[machine].snapshots.s1)
			.filter(([key,c])=>/\|G\|rssCurrent(?:Compile|Inst|First)?$/.test(key) && c.st==='ok' && c.v!=null && Number.isFinite(c.v) && c.v>0)
			.map(([,c])=>c);
		const result=aggregate({...scope,machine},'mem','G',3)!;
		expect(result.v).toBeCloseTo(cells.reduce((sum,c)=>sum+c.v!,0)/cells.length,10);
		expect(result.count).toBe(cells.length);
		expect(result.r).toBe(1);
		expect(result.interval).toBeUndefined();
		expect(cells.some(c=>c.report===result.report)).toBe(true);
	});
	it('does not invent RSS for an uncollected engine',()=>{
        expect(aggregate({...scope,machine:'m2'},'mem','C',3)).toBeNull();
    });
	it('keeps partial captures out of overall RSS rankings while retaining their measurements',()=>{
		const selected={...scope,machine:'m2' as const};
		const ranked=leader(selected,'Lowest average RSS','mem',3,'rss').places.map(p=>p.cfg.id);
		for(const id of ['T','U'] as const){
			const compiled=viewData.catalogue.filter(w=>viewCell(selected.machine,'s1',w.id,id,'compile').st==='ok');
			const missingCompilerRSS=compiled.some(w=>viewCell(selected.machine,'s1',w.id,id,'rssCurrentCompile').st!=='ok');
			expect(viewData.catalogue.some(w=>viewCell(selected.machine,'s1',w.id,id,'rssCurrent').st==='ok')).toBe(true);
			if(missingCompilerRSS){expect(aggregate(selected,'mem',id,3)).toBeNull();expect(ranked).not.toContain(id);}
			else expect(aggregate(selected,'mem',id,3)?.v).toBeGreaterThan(0);
			if(!viewData.applicationConfigurations.includes(id))expect(ranked).not.toContain(id);
		}
	});
	it('does not invent native code breakdowns',()=>{
		expect(aggregate(scope,'code','G',0)).toBeNull();
		expect(aggregate(scope,'code','G',4)).toBeNull();
		expect(aggregate(scope,'code','C',3)).toBeNull();
	});
	it('never substitutes another baseline for an unavailable collector',()=>{
		const result=aggregate({...scope,baseline:'C'},'code','G',3);
		expect(result?.v).toBeGreaterThan(0);
		expect(Number.isNaN(result?.r)).toBe(true);
		expect(result?.ratioInterval).toBeUndefined();
	});
  it('limits application and history comparison cohorts to supported configurations',()=>{
    expect(viewData.applicationConfigurations).toContain('G');
    expect(viewData.applicationConfigurations.every(slot=>['A','D','E','F','G','L','T','U'].includes(slot))).toBe(true);
    expect(Object.keys(viewData.configurations)).toEqual(['A','D','E','F','G','L','T','U']);
    const result=aggregate(scope,'lat','G',3)!;
    expect(result).not.toBeNull();
    expect(viewData.applicationConfigurations.map(slot=>viewData.configurations[slot])).not.toContain('v8-wasmfx');
  });

});
