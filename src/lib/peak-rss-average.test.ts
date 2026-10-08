import {expect,it,vi} from 'vitest';
vi.unmock('./view-data');
import {datasetView,emptyView} from './api/view.svelte';
import {aggregate} from './aggregates';
import {leader} from './model';
it('ranks arithmetic means of captured phase peaks without requiring legacy RSS samples',()=>{
 const old=datasetView.current;const view=emptyView();datasetView.current=view;datasetView.generation++;
 try{
  view.applicationConfigurations=['A','D'];view.catalogue=[{id:'tiny',group:'Tiny',tags:[],kb:null,ms:null}];
  view.hosts.m1.configurations.A={runtime:'wasmtime',version:'1',backend:'compiler'};
  view.hosts.m1.configurations.D={runtime:'wasmer',version:'1',backend:'compiler'};
  view.reports.r={runId:'r',created:'2026-10-08',evidence:'',sha256:'',options:{},codeRecords:[],configurations:[],host:'m1'};
  ['rssCompile','rssInst','rssFirst','rss'].forEach((metric,i)=>{view.hosts.m1.snapshots.s1[`tiny|A|${metric}`]={st:'ok',v:[8,4,2,2][i],report:'r'};view.hosts.m1.snapshots.s1[`tiny|D|${metric}`]={st:'ok',v:8,report:'r'};});
  const scope={machine:'m1' as const,baseline:'A' as const,hide:{},weighting:'workload' as const,cohortMode:'per-engine' as const};
  expect(aggregate(scope,'mem','A',3)).toMatchObject({v:4,count:4,r:1});
  expect(aggregate(scope,'mem','D',3)?.v).toBe(8);
  expect(leader(scope,'Lowest average peak RSS','mem',3,'rss').places.map(p=>p.cfg.id)).toEqual(['A','D']);
  view.hosts.m1.snapshots.s1['tiny|A|rssCompile']={st:'nm',report:''};datasetView.generation++;
  expect(aggregate(scope,'mem','A',3)?.v).toBeCloseTo(8/3);
 }finally{datasetView.current=old;datasetView.generation++;}
});
