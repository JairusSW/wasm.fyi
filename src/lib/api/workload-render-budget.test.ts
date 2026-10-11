import {afterEach,expect,it,vi} from 'vitest';
import {render} from 'svelte/server';
vi.unmock('../view-data');
import Workloads from '../components/bench/Workloads.svelte';
import {datasetView,emptyView} from './view.svelte';
import {apiView} from './controller.svelte';
import {CFG} from '../data/runtimes';
import {ui} from '../state.svelte';
import type {Bench} from '../data/types';
afterEach(()=>{datasetView.current=emptyView();datasetView.generation++;apiView.ready=false});
it('mounts a bounded workload window even with every runtime visible',()=>{
 const view=emptyView();const configs=CFG.slice(0,36);
 view.catalogue=Array.from({length:145},(_,i)=>({id:`applications/test-${i}`,group:`group-${Math.floor(i/6)}`,tags:[],kb:null,ms:null} as Bench));
 for(const cfg of configs){view.hosts.m2.configurations[cfg.id]={runtime:cfg.rt,version:'1',backend:cfg.be};for(const b of view.catalogue)view.hosts.m2.snapshots.s1[`${b.id}|${cfg.id}|steady`]={st:'ok',v:1,report:'r'}}
 datasetView.current=view;datasetView.generation++;apiView.ready=true;ui.machine='m2';ui.exec='all';ui.metric='steady';ui.hide={};ui.q='';ui.tag=null;ui.collapsed={};
 const html=render(Workloads).body;
 expect((html.match(/class="cellbtn wcell/g)||[]).length).toBeLessThanOrEqual(24*configs.length);
 expect(html).toContain('aria-rowcount="171"');
 expect(html).toContain('145');
});
