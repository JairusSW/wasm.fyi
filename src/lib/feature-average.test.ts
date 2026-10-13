import {describe,it,expect,vi} from 'vitest';
import {render} from 'svelte/server';
const {ui}=vi.hoisted(()=>({ui:{cohortMode:'shared' as 'shared'|'per-engine',average:'geo' as 'geo'|'mean',scope:{machine:'m1',baseline:'G',hide:{},weighting:'workload',cohortMode:'shared' as 'shared'|'per-engine',average:'geo' as 'geo'|'mean'}}}));
const {numeric}=vi.hoisted(()=>({numeric:Object.fromEntries([
 ['f32-round-convert',[24083,20792,19500,215500]],
 ['f64-sqrt-convert',[19958,18292,22750,194750]],
 ['integer-div-rem',[16584,15542,19458,162208]],
 ['integer-multiply-add',[15291,13459,16584,76917]],
 ['integer-rotate-popcount',[14625,19125,20375,79333]],
 ['signed-zero-bits',[21792,27750,21167,93458]],
 ].flatMap(([name,values])=>(values as number[]).map((v,k)=>[`features/core-num/${name}/${['1','64','4096','performance-4096x64'][k]}`,v/1e6])))}));
vi.mock('./state.svelte',()=>({ui}));
vi.mock('./model',()=>({featureContracts:(family:string)=>family==='core-num'?Object.keys(numeric).map(id=>({id})):[{id:'features/numeric/a/1'},{id:'features/numeric/a/9'}]}));
vi.mock('./view-data',()=>({viewData:{},viewCell:(_machine:string,_snapshot:string,id:string,c:string)=>({st:'ok',v:numeric[id]??(c==='missing'||c==='partial'&&!id.endsWith('/1')?null:id.endsWith('/1')?1:9)})}));
vi.mock('./api/view.svelte',()=>({datasetView:{revision:''}}));
vi.mock('./api/controller.svelte',()=>({apiView:{aggregates:{}},aggregateKey:()=>'',trackId:(id:string)=>id}));
import FeatureCorpora from './components/FeatureCorpora.svelte';
import {familyCohort,familyValue,featureAverage,featurePerformanceContracts} from './feature-values';
import type {Bench} from './data/types';
import type {Scope} from './model';
const scope:Scope={machine:'m1',baseline:'G',hide:{},weighting:'workload'};
describe('feature averaging selection',()=>{
 it('averages the same six numeric performance contracts shown in expanded rows',()=>{
  // Production Apple M4 Max / wasmtime: tiny compatibility probes must not dilute perf.
  const result=familyCohort({...scope,average:'mean',cohortMode:'per-engine'},'core-num',['G']);
  expect(result.contracts).toHaveLength(6);
  expect(result.values[0]).toBeCloseTo((215500+194750+162208+76917+79333+93458)/6/1e6);
  const geometric=familyCohort({...scope,average:'geo',cohortMode:'per-engine'},'core-num',['G']);
  expect(geometric.values[0]).toBeCloseTo(Math.exp([215500,194750,162208,76917,79333,93458].reduce((sum,v)=>sum+Math.log(v/1e6),0)/6));
  for(const metric of ['compile','rss'])expect(familyCohort({...scope,average:'mean'},'core-num',['G'],metric).contracts).toHaveLength(6);
 });
 it('keeps probes for corpora without a performance contract, respecting execution scope',()=>{
  const contracts=[
   {id:'features/mixed/optimized/1'},
   {id:'features/mixed/optimized/performance-4096x64'},
   {id:'features/mixed/fallback/1'},
   {id:'features/mixed/compile-only/1',evidenceScope:'compile-only'},
  ] as Bench[];
  expect(featurePerformanceContracts(contracts).map(w=>w.id)).toEqual([contracts[1].id,contracts[2].id]);
  expect(featurePerformanceContracts(contracts,'compile').map(w=>w.id)).toEqual([contracts[1].id,contracts[2].id,contracts[3].id]);
 });
 it('changes the family table and leader input from geometric to arithmetic mean',()=>{
  expect(familyCohort({...scope,average:'geo'},'numeric',['G']).values[0]).toBeCloseTo(3);
  expect(familyCohort({...scope,average:'mean'},'numeric',['G']).values[0]).toBe(5);
 });
 it('uses the selected method for standalone family values',()=>{
  expect(familyValue({...scope,average:'mean'},'numeric','G')).toBe(5);
 });
 it('updates expanded corpus averages too',()=>{
  ui.average='geo';ui.scope.average='geo';
  expect(render(FeatureCorpora,{props:{family:'numeric',ids:['G'],mode:'perf'}}).body).toContain('~3 ms');
  ui.average='mean';ui.scope.average='mean';
  expect(render(FeatureCorpora,{props:{family:'numeric',ids:['G'],mode:'perf'}}).body).toContain('~5 ms');
 });
 it('uses the same shared-pass control for expanded corpus rows',()=>{
  ui.average='mean';ui.scope.average='mean';ui.cohortMode='per-engine';ui.scope.cohortMode='per-engine';
  const perEngine=render(FeatureCorpora,{props:{family:'numeric',ids:['G','partial' as never],mode:'perf'}}).body;
  expect(perEngine).toContain('~5 ms');
  ui.cohortMode='shared';ui.scope.cohortMode='shared';
  const shared=render(FeatureCorpora,{props:{family:'numeric',ids:['G','partial' as never],mode:'perf'}}).body;
  expect(shared).not.toContain('~5 ms');expect(shared).toContain('1 ms');
 });
 it('preserves missing values instead of treating them as zero',()=>{
  for(const average of ['geo','mean'] as const){expect(featureAverage([],average)).toBeNull();expect(featureAverage([1,null],average)).toBeNull();}
 });
 it('honors passed-per-engine and shared-pass selection independently of averaging',()=>{
  const ids=['G','partial'] as never[];
  expect(familyCohort({...scope,average:'mean',cohortMode:'per-engine'},'numeric',ids).values).toEqual([5,1]);
  expect(familyCohort({...scope,average:'mean',cohortMode:'shared'},'numeric',ids).values).toEqual([1,1]);
  expect(familyCohort({...scope,average:'geo',cohortMode:'per-engine'},'numeric',ids).values[0]).toBeCloseTo(3);
 });
 it('keeps completely unmeasured families absent in both modes',()=>{
  for(const average of ['geo','mean'] as const)expect(familyCohort({...scope,average},'numeric',['missing' as never]).values).toEqual([null]);
 });
});
