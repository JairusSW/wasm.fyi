import {expect,it,vi} from 'vitest';
vi.unmock('./view-data');
import {datasetView,emptyView} from './api/view.svelte';
import {aggregate} from './aggregates';
import {ui} from './state.svelte';
it('defaults to showing measured phases when another engine cannot measure them',()=>{
 expect(ui.cohortMode).toBe('per-engine');
 const old=datasetView.current;const view=emptyView();datasetView.current=view;datasetView.generation++;
 try{
  view.applicationConfigurations=['A','D'];view.catalogue=[{id:'tiny',group:'Tiny',tags:[],kb:null,ms:null}];
  view.hosts.m1.configurations.A={runtime:'wasmtime',version:'1',backend:'compiler'};
  view.hosts.m1.configurations.D={runtime:'wasmer',version:'1',backend:'compiler'};
  view.reports.r={runId:'r',created:'2026-10-08',evidence:'',sha256:'',options:{},codeRecords:[],configurations:[],host:'m1'};
  for(const metric of ['inst','steady']){view.hosts.m1.snapshots.s1[`tiny|A|${metric}`]={st:'ok',v:0.002,report:'r'};view.hosts.m1.snapshots.s1[`tiny|D|${metric}`]={st:'unsupported',report:'r'};}
  const scope={machine:'m1' as const,baseline:'A' as const,hide:{},weighting:'workload' as const,cohortMode:ui.cohortMode};
  expect(aggregate(scope,'lat','A',1)?.v).toBeCloseTo(0.002);expect(aggregate(scope,'lat','A',3)?.v).toBeCloseTo(0.002);
  expect(aggregate({...scope,cohortMode:'shared'},'lat','A',1)).toBeNull();
 }finally{datasetView.current=old;datasetView.generation++;}
});
