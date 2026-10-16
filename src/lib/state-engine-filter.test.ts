import {describe,it,expect,vi} from 'vitest';
vi.mock('./view-data',()=>({viewData:{hosts:{m1:{configurations:{G:{}}},m2:{configurations:{}}},history:{}}}));
vi.mock('./data/runtimes',()=>({CFG:[{id:'G',rt:'wago'}],execOf:()=> 'compiler',langOf:()=> 'Go'}));
vi.mock('./data/snapshot',()=>({SNAPS:[]}));
vi.mock('./api/view.svelte',()=>({datasetView:{revision:''}}));
import {ui} from './state.svelte';
describe('engine filters before data loads',()=>{
 it('defaults to shared workloads and geometric mean on every comparison route',()=>{
  expect(ui.cohortMode).toBe('shared');expect(ui.average).toBe('geo');
  for(const route of ['/benchmarks','/features','/history']){
   ui.loadFromUrl(new URL(`http://localhost${route}/`),route);
   expect(ui.cohortMode).toBe('shared');expect(ui.average).toBe('geo');
   const query=new URLSearchParams(ui.toSearch(route));
   expect(query.has('cohort')).toBe(false);expect(query.has('avg')).toBe(false);
  }
 });
 it('preserves explicit per-engine and arithmetic mean selections',()=>{
  ui.loadFromUrl(new URL('http://localhost/benchmarks/?cohort=per-engine&avg=mean'),'/benchmarks');
  const query=new URLSearchParams(ui.toSearch('/benchmarks'));
  expect(query.get('cohort')).toBe('per-engine');expect(query.get('avg')).toBe('mean');
 });
 it('round-trips a dynamically loaded compiler in the shared feature comparison',()=>{
  ui.loadFromUrl(new URL('http://localhost/features/?cohort=shared&avg=mean&m=m2&rt=G%2Cengine%3Aw2c2-gcc&view=perf'),'/features');
  const query=new URLSearchParams(ui.toSearch('/features'));
  expect(query.get('rt')).toBe('G,engine:w2c2-gcc');
  expect(ui.cohortMode).toBe('shared');expect(query.has('cohort')).toBe(false);expect(query.get('avg')).toBe('mean');
 });
});
