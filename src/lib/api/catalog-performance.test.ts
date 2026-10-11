import {afterEach,expect,it,vi} from 'vitest';
vi.unmock('../view-data');
import {datasetView,emptyView} from './view.svelte';
import {BENCH,ALLB} from '../data/snapshot';
import type {Bench} from '../data/types';
afterEach(()=>{datasetView.current=emptyView();datasetView.generation++});
it('does not rescan the catalogue for every indexed table access',()=>{
 const entries=Array.from({length:4000},(_,i)=>({id:`applications/workload-${i}`,group:`group-${i%28}`,tags:[],kb:null,ms:null} as Bench));
 let scans=0;
 const catalogue=new Proxy(entries,{get(target,key,receiver){if(key==='filter'||key===Symbol.iterator)scans++;return Reflect.get(target,key,receiver)}});
 const view=emptyView();view.catalogue=catalogue;datasetView.current=view;datasetView.generation++;
 for(let i=0;i<BENCH.length;i++)expect(BENCH[i].items.length).toBeGreaterThan(0);
 expect(ALLB.length).toBe(4000);
 for(let i=0;i<32;i++)expect(ALLB[i].id).toMatch(/^applications\/workload-/);
 expect(scans).toBeLessThanOrEqual(2);
});

it('refreshes catalogue views when the data is replaced',()=>{
 const first=emptyView();first.catalogue=[{id:'applications/one',group:'first',tags:[],kb:null,ms:null} as Bench];datasetView.current=first;
 expect(BENCH[0].g).toBe('first');expect(ALLB[0].id).toBe('applications/one');
 const second=emptyView();second.catalogue=[{id:'applications/two',group:'second',tags:[],kb:null,ms:null} as Bench];datasetView.current=second;
 expect(BENCH[0].g).toBe('second');expect(ALLB[0].id).toBe('applications/two');
});
