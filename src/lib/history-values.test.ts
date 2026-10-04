import { describe, expect, it } from 'vitest';
import { viewCell, viewData } from './view-data';
import { historyCell, historyChange, historySegments, historySeries } from './history-values';
import { aggregate } from './aggregates';
import type { Scope } from './model';

const scope:Scope={machine:'m1',baseline:'A',hide:{},weighting:'workload'};
describe('recorded weekly history',()=>{
	it('aligns host dates and keeps actual revisions and collection dates',()=>{
        expect(viewData.history.m1.points.map(p=>[p.date,p.revision])).toEqual([
            ['2026-09-29','9f01d145d54ac7ab458b6b2f6047db90a757410a'],
            ['2026-10-03','0ef007c70581bf56155a4daf6fce8bda3f2c5ff1']
        ]);
        expect(viewData.history.m2.points.map(p=>p.date)).toEqual(viewData.history.m1.points.map(p=>p.date));
        for(const p of viewData.history.m1.points)expect(p.collectedAt!.slice(0,10)).toBe('2026-10-04');
        for(const machine of ['m1','m2'] as const)expect(viewData.history[machine].versions.G[0]).toBe('v0.1.0-beta.11');
    });
    it('uses the existing beta.11 cells for both hosts without replacing their evidence',()=>{
        for(const machine of ['m1','m2'] as const)for(const workload of viewData.catalogue)
            for(const metric of ['compile','inst','first','steady'] as const){
                const current=viewCell(machine,'s1',workload.id,'G',metric);
                const historical=historyCell(machine,workload.id,'G',metric,0);
                expect(historical.st).toBe(current.st);
                expect(historical.v).toBe(current.v);
                expect(historical.report).toBe(current.report);
            }
    });
    for(const machine of ['m1','m2'] as const)for(const weighting of ['workload','corpus'] as const)
    it(`matches current non-feature latency for the same beta.11 evidence on ${machine} with ${weighting} weighting`,()=>{
        const selected={...scope,machine,baseline:'G' as const,weighting};
        for(const [key,col] of [['compile',0],['inst',1],['exec',3]] as const){
            const current=aggregate(selected,'lat','G',col)!;
            const history=historySeries(selected,'G',key)!;
            expect(history[0]).toBeCloseTo(current.v,12);
        }
    });
    it('does not reuse erased comparison-engine measurements',()=>{
        for(const machine of ['m1','m2'] as const)for(const cid of ['A','D'] as const){
            expect(historyCell(machine,'applications/image-blur',cid,'steady',0).st).toBe('nm');
            expect(historySeries({...scope,machine},cid,'exec')).toBeNull();
        }
    });
	it('retains a failed historical contract as a gap instead of interpolating it',()=>{
		const entry=Object.entries(viewData.history.m1.cells).find(([key,cells])=>key.endsWith('|G|steady') && cells.some(c=>c.st==='failed'))!;
		const workload=entry[0].slice(0,-'|G|steady'.length);
		const values=historySeries(scope,'G','exec',workload);
		expect(values).toBeNull();
		expect(historyCell('m1',workload,'G','steady',0).st).toBe('failed');
		expect(historySegments([1,2,Number.NaN,4],i=>i,v=>v)).toEqual(['0.0,1.0 1.0,2.0','3.0,4.0']);
	});
	it('cannot fabricate history for a feature-only workload or uncollected backend',()=>{
		expect(historySeries(scope,'A','exec','features/simd/i32x4-add/64')).toBeNull();
		expect(historySeries(scope,'C','exec')).toBeNull();
		expect(historyChange({st:'failed',report:''},{st:'ok',v:1,report:'other'})).toBeNull();
	});
});
