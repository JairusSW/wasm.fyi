import {afterEach,expect,it,vi} from 'vitest';
vi.unmock('./view-data');
vi.mock('./aggregates',()=>({aggregate:()=>({v:1,r:1,ci:Number.NaN,count:1,report:'r',reports:[]})}));
import {datasetView,emptyView} from './api/view.svelte';
import {CFG,execOf} from './data/runtimes';
import {leader,endToEndLeader,type Scope} from './model';
const original=datasetView.current;
afterEach(()=>{datasetView.current=original;datasetView.generation++});
function selection(kind:'all'|'compiler'|'interpreter'){
 const compiler=CFG.find(c=>c.rt==='wasmtime'&&execOf(c)==='compiler')!;
 const interpreter=CFG.find(c=>c.rt==='wasmi'&&execOf(c)==='interpreter')!;
 const transpiler=CFG.find(c=>c.rt==='wasm2c')!;
 expect(compiler&&interpreter&&transpiler).toBeTruthy();
 const selected=[compiler,interpreter,transpiler].filter(c=>kind==='all'||execOf(c)===kind);
 const view=emptyView();view.applicationConfigurations=[compiler.id,interpreter.id,transpiler.id];
 for(const c of [compiler,interpreter,transpiler])view.hosts.m1.configurations[c.id]={runtime:c.rt,version:'1',backend:c.be};
 datasetView.current=view;datasetView.generation++;
 const scope:Scope={machine:'m1',baseline:compiler.id,weighting:'workload',cohortMode:'per-engine',exec:kind,hide:Object.fromEntries(CFG.filter(c=>!selected.includes(c)).map(c=>[c.id,true]))};
 return {scope,ids:selected.map(c=>c.id).sort()};
}
for(const kind of ['all','compiler','interpreter'] as const)it(`leader cards rank every selected engine in ${kind} mode`,()=>{
 const {scope,ids}=selection(kind);
 for(const [group,col,metric] of [['lat',0,'compile'],['lat',1,'inst'],['lat',3,'steady'],['mem',3,'rss']] as const){
  expect(leader(scope,'Ranking',group,col,metric).places.map(p=>p.cfg.id).sort(),metric).toEqual(ids);
 }
 expect(endToEndLeader(scope).places.map(p=>p.cfg.id).sort(),'end-to-end').toEqual(ids);
});
