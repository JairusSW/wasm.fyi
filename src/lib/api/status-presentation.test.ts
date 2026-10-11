import {afterEach,expect,it,vi} from 'vitest';
import {render} from 'svelte/server';
vi.unmock('../view-data');
import StatusLegend from '../components/StatusLegend.svelte';
import Matrix from '../components/bench/Matrix.svelte';
import {datasetView,emptyView} from './view.svelte';
import {apiView,aggregateKey} from './controller.svelte';
import {ui} from '../state.svelte';
import {ST} from '../data/status';
const legend=['✓ correct','⊘ unsupported','○ disabled','✕ failed','‼ crashed','◷ timed out','– not measured','· not applicable','— unavailable'];
afterEach(()=>{datasetView.current=emptyView();datasetView.generation++;apiView.precomputed={};apiView.ready=false;ui.group='lat';ui.hide={}});
it('renders the exact shared status legend in order',()=>{
 expect(Object.values(ST).map(([g,l])=>g+' '+l)).toEqual(legend);
 const html=render(StatusLegend).body;
 let previous=-1;for(const entry of legend){const at=html.indexOf(entry);expect(at).toBeGreaterThan(previous);previous=at}
});
it.each(['timer-resolution','incomplete-reference'])('shows unavailable aggregates as a dash while preserving %s in tooltip details',reason=>{
 const view=emptyView();view.applicationConfigurations=['G'];view.configurations.G='wago';view.hosts.m1.configurations.G={runtime:'wago',version:'1',backend:'railshot'};datasetView.current=view;datasetView.generation++;
 ui.machine='m1';ui.group='lat';ui.exec='all';ui.cohortMode='shared';apiView.ready=true;
 for(const metric of ['compile','inst','first','steady'])apiView.precomputed[aggregateKey(ui.scope,metric)]={revision:'r',platform:'p',metric,participants:['wago'],cards:[{engine:'wago',version:'1',backend:'railshot',value:null,ratio:null,count:0,unavailableReason:reason}]};
 const html=render(Matrix,{props:{onmetric:()=>{}}}).body;
 expect(html).not.toContain('Incomplete reference measurements');expect(html).not.toContain('Below timer resolution');
 expect(html.replace(/<!--.*?-->/gs,'').match(/>—<\/button>/g)?.length).toBeGreaterThanOrEqual(4);
 expect(html).toContain(reason==='timer-resolution'?'retained samples are all zero':'no usable measurement for every workload');
});
it.each(['geo','mean'] as const)('shows startup as compile + instantiate for %s, independent of first-call and steady availability',average=>{
 const view=emptyView();view.applicationConfigurations=['G'];view.configurations.G='wago';view.hosts.m1.configurations.G={runtime:'wago',version:'1',backend:'railshot'};datasetView.current=view;datasetView.generation++;
 ui.machine='m1';ui.group='lat';ui.exec='all';ui.cohortMode='shared';ui.average=average;apiView.ready=true;
 const values=average==='geo'?[1e6,2e6]:[4e6,6e6];
 for(const [i,metric] of ['compile','inst','first','steady'].entries())apiView.precomputed[aggregateKey(ui.scope,metric)]={revision:'r',platform:'p',metric,participants:['wago'],cards:[{engine:'wago',version:'1',backend:'railshot',value:values[i]??null,ratio:null,count:1}]};
 const show=()=>render(Matrix,{props:{onmetric:()=>{}}}).body.replace(/<!--.*?-->/gs,'');
 const text=(html:string)=>html.match(/aria-label="Startup latency for wago railshot"[^>]*>([^<]+)<\/button>/)?.[1];
 const html=show();expect(text(html)).toBe(average==='geo'?'~3 ms':'~10 ms');
 expect(html.indexOf('>Instantiation</button>')).toBeLessThan(html.indexOf('>Startup latency</span>'));
 expect(html.indexOf('>Startup latency</span>')).toBeLessThan(html.indexOf('>First call</button>'));
 apiView.precomputed[aggregateKey(ui.scope,'inst')].cards[0].value=null;
 expect(text(show())).toBe('—');
});
