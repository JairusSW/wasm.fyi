import {beforeEach,describe,expect,it,vi} from 'vitest';
import {render} from 'svelte/server';
const {cells,contracts,viewData}=vi.hoisted(()=>({
 viewData:{configurations:{G:'wago'},featureVersions:{m1:[] as {id:string;features:{id:string;total:number;pass:number;failed:number;contracts:{status:string}[]}[]}[]}},
 cells:{} as Record<string,{st:string;v?:number}>,
 contracts:[
  {id:'features/numeric/add/1'},
  {id:'features/numeric/add/performance-4096'},
  {id:'features/numeric/validation/1',evidenceScope:'compile-only'},
  {id:'features/numeric/initialization/1',evidenceScope:'compile-and-instantiate'},
 ],
}));
vi.mock('./model',()=>({featureContracts:()=>contracts}));
vi.mock('./view-data',()=>({viewData,viewCell:(_m:string,_s:string,id:string,c:string,metric:string)=>cells[`${id}|${c}|${metric}`]||{st:'nm'}}));
vi.mock('./state.svelte',()=>({ui:{scope:{machine:'m1',baseline:'G',hide:{},weighting:'workload',cohortMode:'shared',average:'mean'}}}));
import {familyCohort,featureValue} from './feature-values';
import FeatureCorpora from './components/FeatureCorpora.svelte';
import type {Scope} from './model';
const scope:Scope={machine:'m1',baseline:'G',hide:{},weighting:'workload'};
const perf=contracts[1].id;
beforeEach(()=>{
 viewData.featureVersions.m1=[];
 for(const key of Object.keys(cells))delete cells[key];
 for(const c of ['G','H'])for(const w of contracts)for(const metric of ['steady','compile','inst','rss','code'])cells[`${w.id}|${c}|${metric}`]={st:'ok',v:4};
});
describe('feature performance requires the complete correctness suite',()=>{
 it('uses the selected version suite rather than old catalogue contracts',()=>{
  cells[`${contracts[0].id}|G|steady`]={st:'nm'};
  viewData.featureVersions.m1=[{id:'wago',features:[{id:'numeric',total:1,pass:1,failed:0,contracts:[{status:'passed'}]}]}];
  expect(featureValue(scope,perf,'G')).toBe(4);
 });
 it('accepts correctness-only probes verified on first call',()=>{
  cells[`${contracts[0].id}|G|steady`]={st:'nm'};
  cells[`${contracts[0].id}|G|first`]={st:'ok',v:1};
  expect(featureValue(scope,perf,'G')).toBe(4);
 });
 it.each(['failed','unsupported'])('still rejects a selected-version suite containing a %s test',status=>{
  viewData.featureVersions.m1=[{id:'wago',features:[{id:'numeric',total:2,pass:1,failed:status==='failed'?1:0,contracts:[{status:'passed'},{status}]}]}];
  expect(featureValue(scope,perf,'G')).toBeNull();
  expect(familyCohort(scope,'numeric',['G']).statuses).toEqual([status]);
 });
 it.each(['failed','unsupported','crashed','timeout','disabled','nm'])('invalidates all metrics when a correctness probe is %s',st=>{
  cells[`${contracts[0].id}|G|steady`]={st};
  for(const metric of ['steady','compile','rss','code']){
   expect(featureValue(scope,perf,'G',metric)).toBeNull();
   for(const average of ['mean','geo'] as const){
    const result=familyCohort({...scope,average,cohortMode:'per-engine'},'numeric',['G','H'],metric);
    expect(result.values).toEqual([null,4]);
    expect(result.statuses).toEqual([st,'ok']);
   }
  }
 });
 it('requires compile-only and instantiation probes to pass their applicable phases',()=>{
  cells[`${contracts[2].id}|G|compile`]={st:'failed'};
  expect(featureValue(scope,perf,'G')).toBeNull();
  cells[`${contracts[2].id}|G|compile`]={st:'ok',v:4};
  cells[`${contracts[3].id}|G|inst`]={st:'unsupported'};
  expect(featureValue(scope,perf,'G')).toBeNull();
 });
 it('does not rescue invalid features through shared-cohort selection',()=>{
  cells[`${contracts[0].id}|G|steady`]={st:'failed'};
  const result=familyCohort({...scope,cohortMode:'shared'},'numeric',['G','H']);
  expect(result.cohort).toEqual([]);
  expect(result.values).toEqual([null,null]);
 });
 it('does not expose invalid timings in expanded rows through the excluded-cell fallback',()=>{
  cells[`${contracts[0].id}|G|steady`]={st:'failed'};
  const html=render(FeatureCorpora,{props:{family:'numeric',ids:['G'],mode:'perf'}}).body;
  expect(html).toContain('Performance invalid');
  expect(html).not.toContain('4 ms');
 });
 it('restores performance when all tests pass without changing measurements',()=>{
  expect(featureValue(scope,perf,'G')).toBe(4);
  expect(familyCohort(scope,'numeric',['G']).values).toEqual([4]);
 });
});
