import {afterEach,expect,it,vi} from 'vitest';
vi.unmock('../view-data');
import {apiView,aggregateKey} from './controller.svelte';
import {datasetView,emptyView} from './view.svelte';
import {leader,type Scope} from '../model';
import {CFG} from '../data/runtimes';
import type {CompactAggregate} from './compact-matrix';
afterEach(()=>{apiView.precomputed={};datasetView.current=emptyView();datasetView.generation++});
it('populates fastest cards from absolute values when the baseline is hidden',()=>{
 const view=emptyView();view.applicationConfigurations=['G','U'];view.configurations.G='wago';view.configurations.U='w2c2-gcc';
 for(const id of ['G','U'] as const)view.hosts.m1.configurations[id]={runtime:id==='G'?'wago':'w2c2',version:'1',backend:'native'};
 datasetView.current=view;datasetView.generation++;
 const scope:Scope={machine:'m1',baseline:'A',weighting:'corpus',cohortMode:'shared',average:'mean',exec:'all',hide:Object.fromEntries(CFG.map(c=>[c.id,!['G','U'].includes(c.id)]))};
 for(const metric of ['compile','inst','rssAverage','steady'])apiView.precomputed[aggregateKey(scope,metric)]={revision:'test',platform:'test',metric,participants:['wago','w2c2-gcc'],cards:[{engine:'wago',version:'1',backend:'native',value:2000,ratio:null,count:143},{engine:'w2c2-gcc',version:'1',backend:'native',value:1000,ratio:null,count:143}]} satisfies CompactAggregate;
 for(const [label,group,col,metric] of [['Compilation','lat',0,'compile'],['Instantiation','lat',1,'inst'],['Memory','mem',3,'rss'],['Execution','lat',3,'steady']] as const){
  const result=leader(scope,label,group,col,metric);
  expect(result.places.length,label).toBeGreaterThan(0);
  expect(result.places[0].cfg.id).toBe(metric==='compile'?'G':'U');
 }
});
