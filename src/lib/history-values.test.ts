import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregates';
import { fmtU } from './format';
import { viewCell, viewData } from './view-data';
import { historyCell, historyChange, historySegments, historyCurve, historySeries, historyCallDetails, historyReusesEvidence, historyCohort, historyVersionChanges } from './history-values';
import { OTM_KEYS, historyPin } from './data/snapshot';
import { readFileSync } from 'node:fs';
import type { Scope } from './model';

const betaIndex=(machine:'m1'|'m2')=>viewData.history[machine].points.findIndex(p=>p.date==='2026-09-29');
const scope:Scope={machine:'m1',baseline:'A',hide:{},weighting:'workload'};
it('marks measured versions without inventing version changes around gaps',()=>{
 expect(historyVersionChanges(['not collected','v1','not collected','v1','v2','v3'],[NaN,1,NaN,2,3,NaN])).toEqual([1,4]);
 expect(historyVersionChanges(['v1','v2','v1'],[1,NaN,2])).toEqual([0]);
 expect(historyVersionChanges(['v1','v1','v2'],[NaN,NaN,NaN])).toEqual([]);
});
it('does not treat Wago source commits as release versions',()=>{
 const revision='0ef007c70581bf56155a4daf6fce8bda3f2c5ff1';
 expect(historyVersionChanges([revision,'v0.1.0-beta.11',revision,revision+'/source-digest'],[1,2,3,4])).toEqual([1]);
 for(const machine of ['m1','m2'] as const){
  const versions=viewData.history[machine].versions.G;
  const values=historySeries({...scope,machine},'G','exec')!;
  expect(historyVersionChanges(versions,values)).toEqual([betaIndex(machine)]);
 }
});
it('curves between recorded endpoints with bounded horizontal tangents',()=>{
 expect(historyCurve('0,10 20,0 40,5')).toBe('M 0,10 C 10,10 10,0 20,0 C 30,0 30,5 40,5');
 expect(historyCurve('20,5')).toBe('M 20,5');
 expect(historyCurve('')).toBe('');
});
it('connects recorded chart points across empty dates without creating measurements',()=>{
 const values=[Number.NaN,2,Number.NaN,4,Number.NaN];
 expect(historySegments(values,i=>i*10,v=>v,true)).toEqual(['10.0,2.0 30.0,4.0']);
 expect(Number.isNaN(values[2])).toBe(true);
 expect(historySegments([Number.NaN],i=>i,v=>v,true)).toEqual([]);
});
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
        for(const [machine,name] of [['m1','history-hub'],['m2','history']] as const){
            const raw=JSON.parse(readFileSync(new URL(`../../data/${name}/weekly.json`,import.meta.url),'utf8'));
            for(const [i,point] of viewData.history[machine].points.entries()){
                const source=raw.results.find((p:{targetWeek:string})=>new Date(p.targetWeek).toLocaleDateString('en-CA',{timeZone:'America/New_York'})===point.date);
                expect(point.status).toBe(source?.status??'not-collected');
                if(!source)expect(historyCell(machine,'applications/image-blur','G','steady',i).report).toBe('');
            }
        }
    });
    it('uses the same verified beta.11 cells in current and release history',()=>{
        for(const machine of ['m1','m2'] as const)for(const workload of viewData.catalogue)
            for(const metric of ['compile','inst','first','steady'] as const){
                const current=viewCell(machine,'s1',workload.id,'G',metric);
                const historical=historyCell(machine,workload.id,'G',metric,betaIndex(machine));
                if(current.report && !workload.id.startsWith('features/')){
                    expect(historical.report).toBe(current.report);
                    expect(historical.st).toBe(current.st);
                    expect(historical.v).toBe(current.v);
                }
                if(historical.report)expect(viewData.reports[historical.report]).toBeDefined();
            }
    });
    it('retains exact source-pinned beta.11 timing values in the canonical release capture',()=>{
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

it('anchors relative history to each machine first measured point while retaining its earlier gaps',()=>{
 for(const machine of ['m1','m2'] as const){
  const h=viewData.history[machine],i=historyPin(machine);
  expect(h.points[i].status).toBe('measured');
  expect(h.points.slice(0,i).every(p=>p.status!=='measured')).toBe(true);
 }
 expect(historyPin('m1')).toBeGreaterThan(historyPin('m2'));
});


it('does not let an older failure change a later historical average',()=>{
 const selected:Scope={machine:'m2',baseline:'G',hide:{},weighting:'corpus'};
 const h=viewData.history.m2,beta=betaIndex('m2');
 const before=historySeries(selected,'G','exec')![beta];
 const older=h.points.findIndex((p,i)=>i<beta && p.status==='measured' && h.workloads.some(w=>historyCell('m2',w,'G','steady',i).st==='ok'));
 const workload=h.workloads.find(w=>historyCell('m2',w,'G','steady',older).st==='ok'&&historyCell('m2',w,'G','steady',beta).st==='ok')!;
 const cells=h.cells[`${workload}|G|steady`],original=cells[older];
 try{cells[older]={st:'failed',report:original.report,role:original.role};expect(historySeries(selected,'G','exec')![beta]).toBe(before);}finally{cells[older]=original;}
});

it('recalculates every sealed week from its own shared non-feature measurements',()=>{
 let checked=0;
 for(const machine of ['m1','m2'] as const)for(const weighting of ['corpus','workload'] as const){
  const selected:Scope={machine,baseline:'G',hide:{},weighting};
  const h=viewData.history[machine];
  for(const [key,metric] of [['compile','compile'],['inst','inst'],['exec','steady']] as const){
   const series=new Map(viewData.applicationConfigurations.map(cid=>[cid,historySeries(selected,cid,key)]));
   for(const [i,point] of h.points.entries()){
    if(point.status!=='measured'||point.currentLatency?.G)continue;
    const workloads=viewData.catalogue.filter(w=>!w.id.startsWith('features/')&&h.workloads.includes(w.id));
    const ok=(id:string,cid:typeof viewData.applicationConfigurations[number])=>{const c=historyCell(machine,id,cid,metric,i);return !!c.report&&c.st==='ok'&&c.v!=null&&Number.isFinite(c.v)&&c.v>0;};
    const engines=viewData.applicationConfigurations.filter(cid=>workloads.some(w=>ok(w.id,cid)));
    const cohort=workloads.filter(w=>engines.every(cid=>ok(w.id,cid)));
    for(const cid of viewData.applicationConfigurations){
     const value=series.get(cid)?.[i];
     if(!engines.includes(cid)||!cohort.length){expect(value==null||Number.isNaN(value)).toBe(true);continue;}
     const groups=[...new Set(cohort.map(w=>w.group))];
     const logs=cohort.map(w=>Math.log(historyCell(machine,w.id,cid,metric,i).v!));
     const expected=weighting==='workload'?Math.exp(logs.reduce((a,b)=>a+b,0)/logs.length):Math.exp(groups.reduce((sum,g)=>{const indices=cohort.flatMap((w,j)=>w.group===g?[j]:[]);return sum+indices.reduce((a,j)=>a+logs[j],0)/indices.length;},0)/groups.length);
     expect(value).toBeCloseTo(expected,10);
     expect(historyCohort(selected,cid,key,i)).toEqual(cohort.map(w=>w.id));checked++;
    }
   }
  }
 }
 expect(checked).toBeGreaterThan(100);
});


for(const machine of ['m1','m2'] as const)for(const weighting of ['corpus','workload'] as const)
it(`matches current and beta.11 history averages exactly on ${machine} with ${weighting} weighting`,()=>{
 for(const hide of [{},{A:true,D:true}])for(const baseline of ['A','G'] as const){
  const selected:Scope={machine,weighting,hide,baseline};
  const beta=betaIndex(machine);
  expect(viewData.history[machine].points[beta].currentLatency?.G).toBe('s1');
  for(const [key,col] of [['compile',0],['inst',1],['exec',3]] as const){
   const current=aggregate(selected,'lat','G',col)!;
   const historical=historySeries(selected,'G',key)![beta];
   expect(historical).toBe(current.v);
   expect(fmtU(historical,'ms')).toBe(fmtU(current.v,'ms'));
   expect(historyCohort(selected,'G',key,beta)).toHaveLength(current.count);
  }
 }
});
