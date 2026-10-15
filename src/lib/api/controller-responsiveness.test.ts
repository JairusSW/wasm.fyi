import {afterEach,expect,it,vi} from 'vitest';
vi.unmock('../view-data');
import {connectSite,closeSite} from './controller.svelte';
import {datasetView} from './view.svelte';
afterEach(()=>{closeSite();vi.unstubAllGlobals()});
function mockScope(count:number) {
 const contracts=Array.from({length:count},(_,i)=>({workload:`applications/test/${i}`,wasm:'test.wasm',artifactSha256:'a',contractSha256:'c'}));
 vi.stubGlobal('location',{pathname:'/features/',href:'http://localhost/features/'});
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path==='/api/summary')return Response.json({revision:'r',platforms:[{id:'p',cpu:'AMD',os:'linux',arch:'amd64',cores:8,kernel:'test'}]});
  const phase='steady';
  return Response.json({schema:3,revision:'r',platform:'p',phase,total:phase==='steady'?count:0,nextOffset:null,contracts,configurations:[{engine:'wago',version:'1',backend:'jit'}],sources:[null],sampling:[null],capturedAt:['2026-01-01T00:00:00Z'],rows:phase==='steady'?contracts.map((_,i)=>[i+1,i,0,0,0,1000,null,null,'ok','not-measured','not-measured',null,5,0,null,'steady']):[]});
 }));
 closeSite();
}
it('lets pending UI tasks run before publishing a large measurement scope',async()=>{
 mockScope(4000);
 let taskRan=false;
 const task=new Promise<void>(resolve=>setTimeout(()=>{taskRan=true;resolve()},0));
 await connectSite();
 expect(taskRan).toBe(true);
 expect(datasetView.current.catalogue).toHaveLength(4000);
 await task;
});
it('does not publish a cancelled calculation',async()=>{
 mockScope(1000);
 const before=datasetView.current;
 setTimeout(closeSite,0);
 await connectSite();
 expect(datasetView.current).toBe(before);
});
it('reuses history calculations and invalidates them when measurements change',async()=>{
 const {emptyView}=await import('./view.svelte');
 const {historySeries}=await import('../history-values');
 const {aggregateCohort}=await import('../aggregates');
 const view=emptyView();
 view.catalogue=[{id:'applications/test',group:'test'} as import('../data/types').Bench];
 view.applicationConfigurations=['G'];
 view.hosts.m1.configurations.G={runtime:'wago',version:'1',backend:'jit'};
 view.hosts.m1.snapshots.s1['applications/test|G|steady']={st:'ok',v:2,report:'r'};
 view.history.m1.points=[{date:'2026-01-01',revision:'',status:'measured'}];
 view.history.m1.workloads=['applications/test'];
 view.history.m1.cells['applications/test|G|steady']=[{st:'ok',v:2,report:'r',role:'retrospective-revision'}];
 datasetView.current=view;datasetView.generation++;
 const scope={machine:'m1',baseline:'G',weighting:'workload',cohortMode:'shared',hide:{}} as const;
 const first=historySeries(scope,'G','exec');
 expect(first).toEqual([2]);
 expect(historySeries(scope,'G','exec')).toBe(first);
 expect(aggregateCohort(scope,'lat','G',3).cohort).toHaveLength(1);
 expect(aggregateCohort(scope,'lat','T',3).cohort).toHaveLength(0);
 datasetView.current={...view,history:{...view.history,m1:{...view.history.m1,cells:{'applications/test|G|steady':[{st:'ok',v:3,report:'r',role:'retrospective-revision'}]}}}};
 datasetView.generation++;
 expect(historySeries(scope,'G','exec')?.[0]).toBeCloseTo(3,12);
});
