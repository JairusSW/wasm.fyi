import { describe,expect,it,vi } from 'vitest';
import type { Scope } from './model';

const fixture=vi.hoisted(()=>{
 const retained={id:'applications/retained',artifactSha256:'retained-sha',group:'Integer & graph algorithms',tags:[],kb:1,ms:null};
 const retired={id:'applications/retired-cli',artifactSha256:'wasi-sha',group:'Text & parsing',abi:'wasi-preview1',tags:[],kb:2,ms:null};
 const ok=(v:number,report:string)=>({st:'ok',v,report,role:'retrospective-revision'});
 const history={
  catalogue:[retained,retired],workloads:[retained.id,retired.id],artifactSha256:{[retained.id]:'retained-sha',[retired.id]:'wasi-sha'},
  points:[{date:'2026-10-01',status:'measured',currentLatency:{D:'s1'}},{date:'2026-10-03',status:'measured'}],
  referenceCells:Object.fromEntries(['A','D'].flatMap(cid=>[ [retained.id+'|'+cid+'|steady',ok(2,'release-core')],[retired.id+'|'+cid+'|steady',ok(8,'release-wasi')]])),
  cells:Object.fromEntries(['A','D'].flatMap(cid=>[[retained.id+'|'+cid+'|steady',[ok(2,'release-core'),ok(4,'main-core')]],[retired.id+'|'+cid+'|steady',[ok(8,'release-wasi'),{st:'unsupported',report:'main-wasi',role:'retrospective-revision'}]]])),
  versions:{}
 };
 return {retained,retired,viewData:{catalogue:[retained],history:{m1:history},applicationConfigurations:['A','D']}};
});
vi.mock('./view-data',()=>({viewData:fixture.viewData,viewCell:()=>({st:'nm',report:''})}));
import {historyCatalogue,historyCohort,historyCoverage,historyComparison,historySeries,historyAggregateDetails} from './history-values';

const scope:Scope={machine:'m1',baseline:'A',hide:{},weighting:'corpus'};
describe('frozen historical reference independent of prepared inventory',()=>{
 it('retains retired WASI denominator and compares only identical recorded contracts',()=>{
  expect(historyCoverage(scope,'D','exec',0)).toEqual({complete:true,measured:2,reference:2});
  expect(historyCoverage(scope,'D','exec',1)).toEqual({complete:false,measured:1,reference:2});
  expect(historyCohort(scope,'D','exec',1)).toEqual([fixture.retained.id]);
  expect(historySeries(scope,'D','exec')).toEqual([4,4]);
  expect(historyComparison(scope,'D','exec',0,1)).toEqual({before:2,after:4,ratio:2,count:1});
  expect(historyCatalogue('m1').find(w=>w.id===fixture.retired.id)?.abi).toBe('wasi-preview1');
  expect(historyAggregateDetails(scope,'D','exec',1)).toContain('1 of 2');
  expect(historyAggregateDetails(scope,'D','exec',1)).toContain('recorded artifact identities');
 });
 it('honors hidden engines and always retains the selected baseline',()=>{
  expect(historyCoverage({...scope,hide:{D:true}},'D','exec',0).measured).toBe(0);
  expect(historyCoverage({...scope,baseline:'D',hide:{A:true,D:true}},'D','exec',0)).toEqual({complete:true,measured:2,reference:2});
 });
 it('retains dated shared evidence without inventing a missing canonical denominator',()=>{
  const h=fixture.viewData.history.m1,reference=h.referenceCells;
  try {
   h.referenceCells={};
   expect(historyCohort(scope,'D','exec',0)).toEqual([fixture.retained.id,fixture.retired.id]);
   expect(historyCoverage(scope,'D','exec',0)).toEqual({complete:true,measured:2,reference:0});
   expect(historyAggregateDetails(scope,'D','exec',0)).toContain('completeness is unknown');
  }finally{h.referenceCells=reference;}
 });
 it('does not label memory and code cohorts as non-feature-only',()=>{
  for(const key of ['mem','code'] as const){
   expect(historyAggregateDetails(scope,'D',key,0)).toContain('successful workloads');
   expect(historyAggregateDetails(scope,'D',key,0)).not.toContain('non-feature');
  }
 });
 it('uses frozen feature contracts for memory and code cohorts without admitting them to execution',()=>{
  const h=fixture.viewData.history.m1,feature={...fixture.retained,id:'features/recorded-probe',group:'Features · baseline'};
  const keys:string[]=[];
  try {
   h.catalogue.push(feature);
   for(const metric of ['rss','code'])for(const cid of ['A','D']){
    const key=`${feature.id}|${cid}|${metric}`,cell={st:'ok',v:16,report:'recorded-feature',role:'retrospective-revision'};
    keys.push(key);h.referenceCells[key]=cell;h.cells[key]=[cell,cell];
   }
   for(const key of ['mem','code'] as const){
    expect(historyCohort(scope,'D',key,0)).toEqual([feature.id]);
    for(const value of historySeries(scope,'D',key)!)expect(value).toBeCloseTo(16,12);
    expect(historyCoverage(scope,'D',key,0)).toEqual({complete:true,measured:1,reference:1});
    expect(historyAggregateDetails(scope,'D',key,0)).toContain('1 of 1 reference workloads');
   }
   expect(historyCohort(scope,'D','exec',0)).not.toContain(feature.id);
  }finally{h.catalogue.pop();for(const key of keys){delete h.referenceCells[key];delete h.cells[key];}}
 });
 it('does not change historical weights or cells when current contracts are removed or rebuilt',()=>{
  const current=fixture.viewData.catalogue;
  try {
   for(const catalogue of [[],[{...fixture.retired,artifactSha256:'new-core-sha',abi:'core',group:'New category'}],[{...fixture.retired,id:'applications/replacement',artifactSha256:'new-id-sha',abi:'core'}]]){
    fixture.viewData.catalogue=catalogue as typeof current;
    expect(historySeries(scope,'D','exec')).toEqual([4,4]);
    expect(historyCoverage(scope,'D','exec',1)).toEqual({complete:false,measured:1,reference:2});
    expect(historyComparison(scope,'D','exec',0,1)?.ratio).toBe(2);
    expect(historySeries(scope,'D','exec','applications/replacement')).toBeNull();
   }
  }finally{fixture.viewData.catalogue=current;}
 });
});
