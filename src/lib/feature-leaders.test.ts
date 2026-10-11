import {describe,it,expect,vi} from 'vitest';
import {render} from 'svelte/server';
const {ui,configs}=vi.hoisted(()=>({ui:{compatView:'perf',perfMetric:'exec',scope:{machine:'m1',average:'geo' as 'geo'|'mean',cohortMode:'per-engine',hide:{}}},configs:['G','H','I','J','K','L'].map((id,k)=>({id,rt:'runtime'+k,be:'compiler',col:'#888',hollow:false}))}));
vi.mock('./view-data',()=>({viewData:{},viewCell:()=>({st:'ok',v:1})}));
vi.mock('./state.svelte',()=>({ui}));
vi.mock('./data/features',()=>({FEATURE_ROWS:[{id:'a'},{id:'b'},{id:'c'}],COMPAT:[{fams:[{id:'a'},{id:'b'},{id:'c'}]}]}));
vi.mock('./data/runtimes',()=>({FEATURE_CFG:configs,CB:Object.fromEntries(configs.map(c=>[c.id,c]))}));
vi.mock('./model',()=>({featureContracts:()=>[{}],compileExcluded:()=>false}));
vi.mock('./support',()=>({engineFeatureVersions:(_rt:string,_s:unknown,channel:string,id:string)=>channel===(['G','H'].includes(id)?'stable':'development')?['snapshot']:[],runtimeFeatureTrack:(rt:string)=>({expected:6,pass:Number(rt.slice(-1))+1})}));
vi.mock('./api/controller.svelte',()=>({apiView:{ready:true}}));
vi.mock('./tip',()=>({tipCard:()=>''}));
vi.mock('./feature-values',async importOriginal=>({...await importOriginal<object>(),familyCohort:(_s:unknown,f:string,ids:string[])=>({values:ids.map((_,k)=>({a:1,b:4,c:16}[f as 'a']*(k+1)))} )}));
import FeatureLeaders from './components/FeatureLeaders.svelte';
describe('feature leader cards',()=>{
 it('includes measured main snapshots in support rankings',()=>{
  const html=render(FeatureLeaders,{props:{cols:configs.map(c=>c.id) as never[]}}).body;
  expect(html).toContain('runtime5');expect(html).toContain('runtime4');
 });
 it('shows actual compilation time and applies mean selection to both performance cards',()=>{
  ui.scope.average='geo';const geo=render(FeatureLeaders,{props:{cols:configs.map(c=>c.id) as never[]}}).body;
  ui.scope.average='mean';const mean=render(FeatureLeaders,{props:{cols:configs.map(c=>c.id) as never[]}}).body;
  expect(geo).toContain('~4 ms');expect(mean).toContain('~7 ms');expect(mean).not.toContain('lowest');expect(mean).not.toContain('time above');
 });
});
