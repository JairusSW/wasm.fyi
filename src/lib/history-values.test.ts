import { describe, expect, it } from 'vitest';
import { viewData } from './view-data';
import { historyCell, historyChange, historySegments, historySeries } from './history-values';
import type { Scope } from './model';

const scope:Scope={machine:'m1',baseline:'A',hide:{},weighting:'workload'};
describe('recorded weekly history',()=>{
	it('uses eight aligned weekly dates and preserves actual revisions and collection dates',()=>{
		expect(viewData.history.m1.points).toHaveLength(8);
		expect(viewData.history.m2.points.map(p=>p.date)).toEqual(viewData.history.m1.points.map(p=>p.date));
		for(const p of viewData.history.m1.points){expect(p.revision).toMatch(/^[a-f0-9]{40}$/);expect(p.collectedAt!.slice(0,10)).not.toBe(p.date);}
	});
	it('keeps comparison engines on their fixed measured baseline',()=>{
		const values=historySeries(scope,'A','exec')!;
		expect(values).toHaveLength(8);
		expect(new Set(values).size).toBe(1);
		const before=historyCell('m1','wago/tiny/add','A','steady',0);
		const after=historyCell('m1','wago/tiny/add','A','steady',7);
		expect(before.report).toBe(after.report);
		expect(historyChange(before,after)).toEqual({delta:0,interval:[0,0],fixed:true});
	});
	it('includes Wasmer Singlepass as a fixed current comparison on each host',()=>{
    for(const machine of ['m1','m2'] as const)for(const cid of ['D'] as const){
      expect(viewData.history[machine].versions[cid][0]).toBe('7.3.0');
      const first=historyCell(machine,'wago/tiny/add',cid,'steady',0);
      const last=historyCell(machine,'wago/tiny/add',cid,'steady',7);
      expect(first.st).toBe('ok');expect(first.report).toBe(last.report);
      expect(historyChange(first,last)).toEqual({delta:0,interval:[0,0],fixed:true});
    }
  });
	it('retains a failed historical contract as a gap instead of interpolating it',()=>{
		const entry=Object.entries(viewData.history.m1.cells).find(([key,cells])=>key.endsWith('|G|steady') && cells.some(c=>c.st==='failed'))!;
		const workload=entry[0].slice(0,-'|G|steady'.length);
		const values=historySeries(scope,'G','exec',workload)!;
		for(const [i,c] of entry[1].entries())if(c.st==='failed')expect(Number.isNaN(values[i])).toBe(true);
		expect(historySegments([1,2,Number.NaN,4],i=>i,v=>v)).toEqual(['0.0,1.0 1.0,2.0','3.0,4.0']);
	});
	it('cannot fabricate history for a feature-only workload or uncollected backend',()=>{
		expect(historySeries(scope,'A','exec','features/simd/i32x4-add/64')).toBeNull();
		expect(historySeries(scope,'C','exec')).toBeNull();
		expect(historyChange({st:'failed',report:''},{st:'ok',v:1,report:'other'})).toBeNull();
	});
});
