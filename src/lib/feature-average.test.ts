import {describe,it,expect,vi} from 'vitest';
import {render} from 'svelte/server';
const {ui}=vi.hoisted(()=>({ui:{cohortMode:'shared' as 'shared'|'per-engine',average:'geo' as 'geo'|'mean',scope:{machine:'m1',baseline:'G',hide:{},weighting:'workload',cohortMode:'shared' as 'shared'|'per-engine',average:'geo' as 'geo'|'mean'}}}));
vi.mock('./state.svelte',()=>({ui}));
vi.mock('./model',()=>({featureContracts:()=>[{id:'features/numeric/a/1'},{id:'features/numeric/a/9'}]}));
vi.mock('./view-data',()=>({viewData:{},viewCell:(_machine:string,_snapshot:string,id:string,c:string)=>({st:'ok',v:c==='missing'||c==='partial'&&!id.endsWith('/1')?null:id.endsWith('/1')?1:9})}));
vi.mock('./api/view.svelte',()=>({datasetView:{revision:''}}));
vi.mock('./api/controller.svelte',()=>({apiView:{aggregates:{}},aggregateKey:()=>'',trackId:(id:string)=>id}));
import FeatureCorpora from './components/FeatureCorpora.svelte';
import {familyCohort,familyValue,featureAverage} from './feature-values';
import type {Scope} from './model';
const scope:Scope={machine:'m1',baseline:'G',hide:{},weighting:'workload'};
describe('feature averaging selection',()=>{
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
