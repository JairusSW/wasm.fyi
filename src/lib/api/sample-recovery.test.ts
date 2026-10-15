import {expect,it,vi,afterEach} from 'vitest';
vi.unmock('../view-data');
import {unpackMatrix,type CompactMatrix} from './compact-matrix';
import {datasetView,emptyView} from './view.svelte';
import {correctnessWorkloads,cov,type Scope} from '../model';
afterEach(()=>{datasetView.current=emptyView();datasetView.generation++});
it('recovers zero medians from retained sample statistics without mutating the response',()=>{
 const page:CompactMatrix={schema:2,revision:'r',platform:'p',phase:'steady',total:1,nextOffset:null,contracts:[{workload:'app/test',wasm:'test.wasm',artifactSha256:'a',contractSha256:'c'}],configurations:[{engine:'jsc',version:'1',backend:'omg'}],sources:[null],sampling:[null],capturedAt:['2026-10-09'],rows:[[1,0,0,0,0,0,null,null,'ok','not-measured','not-measured',null,25,0,[24,2500,6756,0,20000]]]};
 expect(unpackMatrix(page)[0]).toMatchObject({latencyNs:2500,latencySummary:'retained-mean'});
 expect(page.rows[0][5]).toBe(0);
 page.rows[0][14]=[25,0,0,0,0];expect(unpackMatrix(page)[0].latencyNs).toBe(0);
});
it('keeps correctness against the whole corpus in both average modes',()=>{
 const view=emptyView();view.applicationConfigurations=['G','U'];view.configurations.G='wago';view.configurations.U='w2c2-gcc';
 view.catalogue=['one','two','three'].map(id=>({id:'applications/'+id,group:'test'})) as typeof view.catalogue;
 for(const id of ['G','U'] as const)view.hosts.m1.configurations[id]={runtime:id==='G'?'wago':'w2c2',version:'1',backend:'native'};
 for(const [i,w] of view.catalogue.entries())for(const id of ['G','U'] as const)view.hosts.m1.snapshots.s1[`${w.id}|${id}|steady`]={st:id==='G'&&i===2?'failed':'ok',v:1,report:'r'};
 datasetView.current=view;datasetView.generation++;
 const s:Scope={machine:'m1',baseline:'G',weighting:'workload',cohortMode:'shared',hide:{}};
 expect(correctnessWorkloads(s)).toHaveLength(3);expect(cov('G',s)).toEqual([2,1,0,0,0]);
 expect(cov('G',{...s,cohortMode:'per-engine'})).toEqual(cov('G',s));
});
it('decodes all-phase tables with detail policies omitted',()=>{
 const page:CompactMatrix={schema:3,revision:'r',platform:'p',phase:'steady',total:2,nextOffset:null,contracts:[{workload:'app/test',wasm:'test.wasm',artifactSha256:'a',contractSha256:'c'}],configurations:[{engine:'wago',version:'1',backend:'railshot'}],sources:[null],sampling:[null],capturedAt:['date'],rows:[[1,0,0,0,0,125,null,null,'ok','not-measured','not-measured',null,10,0,null,'compile'],[2,0,0,0,0,0,null,null,'ok','not-measured','not-measured',null,25,0,[25,125,null,0,500],'steady']]};
 expect(unpackMatrix(page)).toMatchObject([{phase:'compile',latencyNs:125,observationId:1},{phase:'steady',latencyNs:125,latencySummary:'retained-mean',observationId:2}]);
 expect(unpackMatrix(page)[0].sampling).toBeUndefined();
});
it('decodes compact status/phase codes without losing fractional timings or native code',()=>{
 const page:CompactMatrix={schema:4,revision:'r',platform:'p',phase:'*',total:2,nextOffset:null,contracts:[{workload:'app/test',wasm:'test.wasm',artifactSha256:'a',contractSha256:'c'}],configurations:[{engine:'wago',version:'1',backend:'railshot'}],sources:[null],sampling:[null],codeKinds:['native-image',null],capturedAt:['date'],rows:[[1,0,0,0,0,0,0.125,4096,64,73,0,10,null],[2,0,0,0,0,3,0,null,null,25,1,25,0.0625]]};
 expect(unpackMatrix(page)).toMatchObject([{phase:'compile',latencyNs:0.125,peakRssBytes:4096,codeBytes:64,codeKind:'native-image',latencyStatus:'ok',memoryStatus:'ok',codeStatus:'ok'},{phase:'steady',latencyNs:0.0625,latencySummary:'retained-mean',memoryStatus:'unsupported',codeStatus:'not-measured',codeKind:null}]);
 page.rows[0][9]=511;expect(()=>unpackMatrix(page)).toThrow('Invalid table status');
});
