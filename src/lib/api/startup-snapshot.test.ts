import {afterEach,expect,it,vi} from 'vitest';
vi.unmock('../view-data');
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules()});
const platform={id:'apple',cpu:'Apple M4 Max',os:'darwin',arch:'arm64',cores:16,kernel:'test',latestRevision:'latest',historyRevision:'history'};
const legacy={...platform,id:'legacy',cpu:'unknown'};
it('opens another machine from one static snapshot without downloading the feature tables',async()=>{
 const {emptyView}=await import('./view.svelte');
 const {encodeBakedSeed}=await import('./baked-codec');
 const view=emptyView();view.configurations.G='wago';view.hosts.m2.configurations.G={runtime:'wago',version:'1',backend:'jit'};
 view.hosts.m2.snapshots.s1['features/simd/add/1|G|steady']={st:'ok',v:1,report:''};
 const summary={revision:'r',platforms:[platform,legacy]};
 const snapshot={schema:2 as const,revision:'r',machine:'m2' as const,path:'/features/',summary,view,slots:[],precomputed:{},loaded:[['m2',JSON.stringify(['latest','latest'])+'|features']],phases:[['m2',['compile','instantiate','first-call','steady']]],metadata:[]} as import('./page-seed').BakedPageSeed;
 const request=vi.fn(async(path:string)=>{
  if(path==='/api/summary')return Response.json(summary);
  if(path==='/data/startup/features/m2.json')return Response.json(encodeBakedSeed(snapshot));
  throw Error('Unexpected bulk request: '+path);
 });
 vi.stubGlobal('fetch',request);vi.stubGlobal('location',{pathname:'/features/',href:'https://wasm.fyi/features/?m=m2'});
 const {ui}=await import('../state.svelte');ui.machine='m2';
 const {connectSite,apiView,closeSite}=await import('./controller.svelte');
 const {datasetView}=await import('./view.svelte');
 await connectSite();
 expect(apiView.error).toBe('');expect(apiView.ready).toBe(true);
 expect(datasetView.current.hosts.m2.snapshots.s1['features/simd/add/1|G|steady']).toMatchObject({st:'ok',v:1});
 expect(request.mock.calls.map(([path])=>path)).toEqual(['/api/summary','/data/startup/features/m2.json']);
 await connectSite();expect(request).toHaveBeenCalledTimes(2);
 closeSite();
});
it('excludes incompatible legacy platform identities from the initial history query',async()=>{
 const request=vi.fn(async(path:string)=>{
  const url=new URL(path,'https://wasm.fyi');
  if(path==='/api/summary')return Response.json({revision:'r',platforms:[platform,legacy]});
  if(path.startsWith('/data/'))return new Response('',{status:404});
  if(url.pathname==='/api/aggregates')return Response.json({revision:'r',platform:'apple',metric:'steady',workloads:[],participants:['wago'],cards:[{engine:'wago',version:'1',backend:'jit',value:1,ratio:1,count:1}]});
  if(url.pathname==='/api/history/summary'){
   if(url.searchParams.get('platforms')!=='apple')return Response.json({error:{message:'history environments must belong to the same host'}},{status:400});
   return Response.json({revision:'r',platform:'apple',metric:'exec',items:[],workloads:[],participants:[]});
  }
  throw Error('Unexpected request '+path);
 });
 vi.stubGlobal('fetch',request);vi.stubGlobal('location',{pathname:'/history/',href:'https://wasm.fyi/history/?m=m2'});
 const {ui}=await import('../state.svelte');ui.machine='m2';
 const {connectSite,loadHistory,apiView,closeSite}=await import('./controller.svelte');
 const {apiHistory}=await import('./history.svelte');
 await connectSite();await loadHistory({...ui.scope,machine:'m2',snapshot:'s1',metric:'steady'},'exec');
 expect(apiHistory.error).toBe('');expect(apiView.historyLoaded.m2).toBe(true);
 closeSite();
});
it('restores the initial history chart from its machine snapshot without a history API read',async()=>{
 const {emptyView}=await import('./view.svelte');
 const {encodeBakedSeed}=await import('./baked-codec');
 const {localDate}=await import('./calendar-date');
 const view=emptyView();view.configurations.A='wasmtime';view.hosts.m2.configurations.A={runtime:'wasmtime',version:'1',backend:'jit'};
 const summary={revision:'r',platforms:[platform,legacy]};
 const query=new URLSearchParams({platform:'apple',platforms:'apple',metric:'exec',engines:'wasmtime',baseline:'wasmtime',weighting:'workload',cohort:'shared',average:'geo',from:'2024-10-01',to:localDate()}).toString();
 const result={revision:'history-r',platform:'apple',metric:'exec' as const,workloads:['applications/test'],items:['2026-10-01','2026-10-02'].map(date=>({date,lanes:[{engine:'wasmtime',value:1000,count:1,reference:1,version:'1',backend:'jit',latestCreated:date,fingerprint:'a'}]}))};
 const snapshot={schema:2 as const,revision:'r',machine:'m2' as const,path:'/history/',summary,view,slots:[],precomputed:{},loaded:[],phases:[],metadata:[['m2',JSON.stringify(['latest','latest'])]],history:{query,summary:result}} as import('./page-seed').BakedPageSeed;
 const request=vi.fn(async(path:string)=>{
  if(path==='/api/summary')return Response.json(summary);
  if(path==='/data/startup/history/m2.json')return Response.json(encodeBakedSeed(snapshot));
  if(path.startsWith('/api/history/summary?'))return Response.json(result);
  throw Error('Unexpected history startup request: '+path);
 });
 vi.stubGlobal('fetch',request);vi.stubGlobal('location',{pathname:'/history/',href:'https://wasm.fyi/history/?m=m2'});
 const {ui}=await import('../state.svelte');ui.machine='m2';
 const {connectSite,loadHistory,apiView,closeSite}=await import('./controller.svelte');
 const {datasetView}=await import('./view.svelte');
 await connectSite();await loadHistory({...ui.scope,machine:'m2',snapshot:'s1',metric:'steady'},'exec');
 expect(apiView.error).toBe('');expect(apiView.historyLoaded.m2).toBe(true);
 expect(datasetView.current.history.m2.points).toHaveLength(2);
 ui.loadFromUrl(new URL('https://wasm.fyi/history/?m=m2'),'/history');
 expect(ui.histTo,'hydration keeps the full baked history window').toBe(1);
 expect(request.mock.calls.map(([path])=>path)).toEqual(['/api/summary','/data/startup/history/m2.json']);
 ui.average='mean';
 await loadHistory({...ui.scope,machine:'m2',snapshot:'s1',metric:'steady'},'exec');
 expect(request.mock.calls).toHaveLength(3);
 expect(new URL(request.mock.calls[2][0],'https://wasm.fyi').searchParams.get('average')).toBe('mean');
 closeSite();
});
it('does not restore averages baked with an obsolete cohort policy',async()=>{
 const {emptyView}=await import('./view.svelte');
 const {activatePageSeed,apiView,closeSite}=await import('./controller.svelte');
 closeSite();apiView.precomputed={};
 const value={revision:'r',platform:'apple',metric:'steady',participants:[],cards:[]};
 const seed={schema:2 as const,revision:'r',machine:'m2' as const,path:'/benchmarks/',summary:{revision:'r',platforms:[platform]},view:emptyView(),slots:[],precomputed:{old:value,current:{...value,policy:'common-passes-v1'}},loaded:[],phases:[],metadata:[]} as import('./page-seed').BakedPageSeed;
 activatePageSeed(seed);
 expect(apiView.precomputed.old).toBeUndefined();
 expect(apiView.precomputed.current).toEqual({...value,policy:'common-passes-v1'});
 closeSite();
});
it('refreshes the static startup payload when a new publication changes its revision',async()=>{
 const {emptyView}=await import('./view.svelte');const {encodeBakedSeed}=await import('./baked-codec');
 let revision='old',now=1000;vi.spyOn(Date,'now').mockImplementation(()=>now);
 const summary=()=>({revision,platforms:[{...platform,latestRevision:revision}]});
 const request=vi.fn(async(path:string)=>{
  if(path==='/api/summary')return Response.json(summary());
  if(path==='/data/startup/features/m2.json'){
   const view=emptyView();view.configurations.G='wago';view.hosts.m2.configurations.G={runtime:'wago',version:revision,backend:'jit'};
   view.hosts.m2.snapshots.s1['features/simd/add/1|G|steady']={st:'ok',v:revision==='old'?1:2,report:''};
   return Response.json(encodeBakedSeed({schema:2,revision,machine:'m2',path:'/features/',summary:summary(),view,slots:[],precomputed:{},loaded:[['m2',JSON.stringify([revision])+'|features']],phases:[['m2',['compile','instantiate','first-call','steady']]],metadata:[]}));
  }
  throw Error('Static startup data should replace the bulk request: '+path);
 });
 vi.stubGlobal('fetch',request);vi.stubGlobal('location',{pathname:'/features/',href:'https://wasm.fyi/features/?m=m2'});
 const {ui}=await import('../state.svelte');ui.machine='m2';
 const {connectSite,apiView,closeSite}=await import('./controller.svelte');
 const {datasetView}=await import('./view.svelte');
 try{
  await connectSite();expect(apiView.error).toBe('');
  revision='new';now+=16000;await connectSite();
  expect(apiView.error).toBe('');expect(datasetView.current.hosts.m2.snapshots.s1['features/simd/add/1|G|steady'].v).toBe(2);
  expect(request.mock.calls.filter(([path])=>path.startsWith('/data/'))).toHaveLength(2);
 }finally{closeSite();vi.restoreAllMocks()}
});
