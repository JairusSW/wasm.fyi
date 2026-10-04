import { describe, expect, it } from 'vitest';
import { viewCell, viewData } from './view-data';
import { historyCell, historyChange, historySegments, historySeries } from './history-values';
import { readFileSync } from 'node:fs';
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
    it('keeps unchanged beta.11 cells aligned while refreshed current evidence stays separate',()=>{
        for(const machine of ['m1','m2'] as const)for(const workload of viewData.catalogue)
            for(const metric of ['compile','inst','first','steady'] as const){
                const current=viewCell(machine,'s1',workload.id,'G',metric);
                const historical=historyCell(machine,workload.id,'G',metric,0);
                if(historical.report===current.report){
                    expect(historical.st).toBe(current.st);
                    expect(historical.v).toBe(current.v);
                }
                if(historical.report)expect(viewData.reports[historical.report]).toBeDefined();
            }
    });
    it('retains exact archived beta.11 timing values after current measurements are refreshed',()=>{
        const reports=new Map<string,ReturnType<typeof JSON.parse>>();
        for(const machine of ['m1','m2'] as const)for(const workload of viewData.catalogue)
            for(const [metric,scenario] of [['compile','compile'],['inst','instantiate'],['first','first-call'],['steady','steady']] as const){
                const historical=historyCell(machine,workload.id,'G',metric,0);
                if(historical.st!=='ok')continue;
                if(!reports.has(historical.report))reports.set(historical.report,JSON.parse(readFileSync(new URL(`../../data/wasmbench/${historical.report}.json`,import.meta.url),'utf8')));
                const report=reports.get(historical.report)!;
                const summary=report.summaries.find((s:{runtime:string;workload:string;scenario:string;profile:string})=>s.runtime==='wago'&&s.workload===workload.id&&s.scenario===scenario&&s.profile==='timing');
                expect(summary).toBeDefined();
                expect(historical.v).toBe(summary.median_ns_per_operation/1e6);
                expect(report.runtimes.find((r:{id:string})=>r.id==='wago').description.runtime_version).toMatch(/^9f01d145d54ac7ab458b6b2f6047db90a757410a\//);
            }
    });
    it('uses recorded directional call medians and their estimated sum for every revision',()=>{
        for(const machine of ['m1','m2'] as const){
            const selected={...scope,machine};
            const a=historySeries(selected,'G','wasmHost')!,b=historySeries(selected,'G','hostWasm')!,round=historySeries(selected,'G','roundTrip')!;
            for(const i of [0,1]){
                expect(a[i]).toBe(historyCell(machine,'mechanisms/wasm-to-host-call','G','steady',i).v);
                expect(b[i]).toBe(historyCell(machine,'mechanisms/host-to-wasm-call','G','steady',i).v);
                expect(round[i]).toBe(a[i]+b[i]);
            }
            expect(historySeries(selected,'A','roundTrip')).toBeNull();
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
