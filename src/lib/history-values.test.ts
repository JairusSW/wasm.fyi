import { describe, expect, it } from 'vitest';
import { viewCell, viewData } from './view-data';
import { historyCell, historyChange, historySegments, historySeries, historyCallDetails, historyReusesEvidence } from './history-values';
import { OTM_KEYS } from './data/snapshot';
import { readFileSync } from 'node:fs';
import type { Scope } from './model';

const betaIndex=(machine:'m1'|'m2')=>viewData.history[machine].points.findIndex(p=>p.date==='2026-09-29');
const scope:Scope={machine:'m1',baseline:'A',hide:{},weighting:'workload'};
describe('recorded weekly history',()=>{
	it('aligns host dates and keeps actual revisions and collection dates',()=>{
        const dates=viewData.history.m1.points.map(p=>p.date);
        expect(dates).toEqual([...dates].sort());
        expect(viewData.history.m2.points.map(p=>p.date)).toEqual(dates);
        for(const machine of ['m1','m2'] as const){
            const beta=betaIndex(machine);expect(beta).toBeGreaterThanOrEqual(0);
            expect(viewData.history[machine].points[beta].revision).toBe('9f01d145d54ac7ab458b6b2f6047db90a757410a');
            expect(viewData.history[machine].versions.G[beta]).toBe('v0.1.0-beta.11');
            for(const p of viewData.history[machine].points)if(p.collectedAt)expect(Date.parse(p.collectedAt)).toBeGreaterThan(Date.parse(p.date+'T00:00:00Z'));
        }
        const older=dates.indexOf('2026-09-26');
        if(older>=0){expect(viewData.history.m1.points[older].status).toBe('not-collected');expect(historyCell('m1','applications/image-blur','G','steady',older).report).toBe('');}
    });
    it('keeps unchanged beta.11 cells aligned while refreshed current evidence stays separate',()=>{
        for(const machine of ['m1','m2'] as const)for(const workload of viewData.catalogue)
            for(const metric of ['compile','inst','first','steady'] as const){
                const current=viewCell(machine,'s1',workload.id,'G',metric);
                const historical=historyCell(machine,workload.id,'G',metric,betaIndex(machine));
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
                const historical=historyCell(machine,workload.id,'G',metric,betaIndex(machine));
                if(historical.st!=='ok')continue;
                if(!reports.has(historical.report))reports.set(historical.report,JSON.parse(readFileSync(new URL(`../../data/${viewData.reports[historical.report].evidence.includes('/')?viewData.reports[historical.report].evidence:'wasmbench/'+viewData.reports[historical.report].evidence}`,import.meta.url),'utf8')));
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
            for(const [i] of viewData.history[machine].points.entries()){
                const left=historyCell(machine,'mechanisms/wasm-to-host-call','G','steady',i),right=historyCell(machine,'mechanisms/host-to-wasm-call','G','steady',i);
                if(left.st==='ok'&&right.st==='ok'){
                    expect(a[i]).toBe(left.v);expect(b[i]).toBe(right.v);expect(round[i]).toBe(a[i]+b[i]);
                }else expect(round[i]).toBeNaN();
            }
            const other=historySeries(selected,'A','roundTrip');
            expect(other == null || Number.isNaN(other[betaIndex(machine)])).toBe(true);
        }
    });
    it('does not reuse erased comparison-engine measurements',()=>{
        for(const machine of ['m1','m2'] as const)for(const cid of ['A','D'] as const){
            expect(historyCell(machine,'applications/image-blur',cid,'steady',betaIndex(machine)).st).toBe('nm');
            const series=historySeries({...scope,machine},cid,'exec');
            expect(series == null || Number.isNaN(series[betaIndex(machine)])).toBe(true);
        }
    });
	it('retains a failed historical contract as a gap instead of interpolating it',()=>{
		const entry=Object.entries(viewData.history.m1.cells).find(([key,cells])=>key.endsWith('|G|steady') && cells.some(c=>c.st==='failed'))!;
		const workload=entry[0].slice(0,-'|G|steady'.length);
		const values=historySeries(scope,'G','exec',workload);
		const failed=entry[1].findIndex(c=>c.st==='failed');
		expect(values==null || Number.isNaN(values[failed])).toBe(true);
		expect(historyCell('m1',workload,'G','steady',failed).st).toBe('failed');
		expect(historySegments([1,2,Number.NaN,4],i=>i,v=>v)).toEqual(['0.0,1.0 1.0,2.0','3.0,4.0']);
	});
	it('cannot fabricate history for a feature-only workload or uncollected backend',()=>{
		expect(historySeries(scope,'A','exec','features/simd/i32x4-add/64')).toBeNull();
		expect(historySeries(scope,'C','exec')).toBeNull();
		expect(historyChange({st:'failed',report:''},{st:'ok',v:1,report:'other'})).toBeNull();
	});
});


it('uses one round-trip history tab while keeping directional measurements in its details',()=>{
 expect(OTM_KEYS).toContain('roundTrip');expect(OTM_KEYS).not.toContain('wasmHost');expect(OTM_KEYS).not.toContain('hostWasm');
 expect(historyCallDetails({...scope,baseline:'G'},'G',betaIndex('m1'))).toContain('Wasm → host:');
 expect(historyCallDetails({...scope,baseline:'G'},'G',betaIndex('m1'))).toContain('Host → Wasm:');
 expect(historyCallDetails({...scope,baseline:'G'},'G',betaIndex('m1'))).toContain('not a measured nested round trip');
});
it('retains a newly recorded engine point without filling its older gap',()=>{
 const h=viewData.history.m1,last=h.points.length-1,beta=betaIndex('m1');
 const workload=h.workloads.find(w=>!w.startsWith('features/')&&historyCell('m1',w,'G','steady',last).st==='ok'&&historyCell('m1',w,'G','steady',beta).st==='ok')!;
 const prior=h.cells;
 try {
  h.cells={...prior};
  for(const key of Object.keys(h.cells))if(key.endsWith('|A|steady'))h.cells[key]=h.points.map(()=>({st:'nm',report:'',role:'retrospective-revision'}));
  h.cells[`${workload}|A|steady`][last]={...historyCell('m1',workload,'G','steady',last),role:'retrospective-revision'};
  const values=historySeries({...scope,baseline:'G',hide:Object.fromEntries(viewData.applicationConfigurations.filter(c=>c!=='G'&&c!=='A').map(c=>[c,true]))},'A','exec');
  expect(values).not.toBeNull();expect(values!.slice(0,last).every(Number.isNaN)).toBe(true);expect(values![last]).toBeGreaterThan(0);
  expect(historySeries({...scope,baseline:'G'},'A','cov')![0]).toBeNaN();
 } finally {h.cells=prior;}
});

it('identifies reused WAVM evidence without treating equal version labels as proof',()=>{
 const h=viewData.history.m2,a=h.points.findIndex(p=>p.date==='2026-09-26'),b=h.points.findIndex(p=>p.date==='2026-10-03');
 if(a>=0){expect(historyReusesEvidence('m2','L','roundTrip',a,b)).toBe(true);expect(historyReusesEvidence('m2','G','roundTrip',a,b)).toBe(false);}
 expect(historyReusesEvidence('m2','L','roundTrip',b,b)).toBe(false);
});
