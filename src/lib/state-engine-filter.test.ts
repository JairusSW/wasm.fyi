import {describe,it,expect,vi} from 'vitest';
vi.mock('./view-data',()=>({viewData:{hosts:{m1:{configurations:{G:{}}},m2:{configurations:{}}},history:{}}}));
vi.mock('./data/runtimes',()=>({CFG:[{id:'G',rt:'wago'}],execOf:()=> 'compiler',langOf:()=> 'Go'}));
vi.mock('./data/snapshot',()=>({SNAPS:[]}));
vi.mock('./api/view.svelte',()=>({datasetView:{revision:''}}));
import {ui} from './state.svelte';
describe('engine filters before data loads',()=>{
 it('round-trips a dynamically loaded compiler in the shared feature comparison',()=>{
  ui.loadFromUrl(new URL('http://localhost/features/?cohort=shared&avg=mean&m=m2&rt=G%2Cengine%3Aw2c2-clang&view=perf'),'/features');
  const query=new URLSearchParams(ui.toSearch('/features'));
  expect(query.get('rt')).toBe('G,engine:w2c2-clang');
  expect(query.get('cohort')).toBe('shared');expect(query.get('avg')).toBe('mean');
 });
});
