import {it,expect,vi} from 'vitest';
vi.unmock('../view-data');
import './controller.svelte';
import {datasetView,emptyView} from './view.svelte';
import {CFG} from '../data/runtimes';
import {featureColumns} from '../feature-leaders';
it('lists only the measured backend when another backend shares its runtime name',()=>{
 const view=emptyView();
 view.configurations['engine:wasmedge-jit']='wasmedge-jit';
 view.featureVersions.m2=[{id:'wasmedge-jit',channel:'stable',version:'0.18.1'} as never];
 datasetView.current=view;datasetView.generation++;
 const scope={machine:'m2' as const,baseline:'A' as const,weighting:'workload' as const,hide:{}};
 expect(CFG.filter(c=>c.rt==='wasmedge').length).toBeGreaterThan(1);
 expect(featureColumns(scope).filter(c=>c.rt==='wasmedge').map(c=>c.id)).toEqual(['engine:wasmedge-jit']);
});
