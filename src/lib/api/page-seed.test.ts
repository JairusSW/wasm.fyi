import {afterEach,expect,it,vi} from 'vitest';
vi.unmock('../view-data');
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules()});
it('bakes scalar results, hydrates without fetching, and reuses them after a revision check',async()=>{
 const platform={id:'linux',cpu:'Test CPU',os:'linux',arch:'amd64',cores:8,kernel:'test',latestRevision:'r'};
 const request=vi.fn(async(resource:string|URL|Request)=>{
  const url=new URL(String(resource),'https://example.test');
  if(url.pathname==='/api/summary')return Response.json({revision:'r',platforms:[platform]});
  if(url.pathname==='/api/observation')return Response.json({samplesNs:[1000,2000]});
  if(url.pathname==='/api/aggregates')return Response.json({items:[]});
  return Response.json({schema:3,revision:'r',platform:'linux',phase:'*',total:4,nextOffset:null,contracts:[{workload:'applications/test',wasm:'test.wasm',artifactSha256:'a',contractSha256:'c'}],configurations:[{engine:'wago',version:'1',backend:'railshot'}],sources:[null],sampling:[null],capturedAt:['date'],rows:['compile','instantiate','first-call','steady'].map((phase,i)=>[i+1,0,0,0,0,1000,null,null,'ok','not-measured','not-measured',null,5,0,null,phase])});
 });
 vi.stubGlobal('fetch',request);
 const {bakePageSeed,activatePageSeed,connectSite,closeSite,loadCellSamples,apiView}=await import('./controller.svelte');
 const {datasetView}=await import('./view.svelte');
 const {encodeBakedSeed,decodeBakedSeed}=await import('./baked-codec');
 const seed=decodeBakedSeed(encodeBakedSeed(await bakePageSeed('https://example.test','/benchmarks/')));
 expect(request.mock.calls.every(([resource])=>String(resource).startsWith('https://example.test/api/'))).toBe(true);
 expect(seed.phases[0][1]).toEqual(['compile','instantiate','first-call','steady']);
 request.mockClear();
 activatePageSeed(seed);
 expect(request).not.toHaveBeenCalled();
 expect(apiView.ready).toBe(true);
 for(const phase of ['compile','inst','first','steady'])expect(datasetView.current.hosts.m1.snapshots.s1[`applications/test|G|${phase}`]).toMatchObject({st:'ok',v:0.001});
 vi.stubGlobal('location',{pathname:'/benchmarks/',href:'https://example.test/benchmarks/'});
 await connectSite();
 expect(apiView.error).toBe('');
 expect(request.mock.calls.map(([resource])=>String(resource))).toEqual(['/api/summary']);
 request.mockClear();
 await loadCellSamples('m1','s1','applications/test','G','steady',new AbortController().signal);
 expect(request.mock.calls).toHaveLength(1);
 expect(String(request.mock.calls[0][0])).toContain('/api/observation?');
 expect(datasetView.current.hosts.m1.snapshots.s1['applications/test|G|steady'].samples).toEqual([0.001,0.002]);
 closeSite();
});
it('fails a snapshot build when the API stays unavailable after retries',async()=>{
 const request=vi.fn(async()=>Response.json({error:{message:'unavailable'}},{status:503}));
 vi.stubGlobal('fetch',request);
 const {bakePageSeed}=await import('./controller.svelte');
 vi.useFakeTimers();
 try{
  const failed=expect(bakePageSeed('https://example.test','/')).rejects.toThrow('unavailable');
  await vi.runAllTimersAsync();
  await failed;
 }finally{vi.useRealTimers()}
 // Reads are retried with backoff before the build gives up.
 expect(request.mock.calls.filter(([resource])=>String(resource).includes('/api/summary'))).toHaveLength(4);
});
it('opens a baked page in the browser without any API request',async()=>{
 const platform={id:'linux',cpu:'Test CPU',os:'linux',arch:'amd64',cores:8,kernel:'test',latestRevision:'r'};
 const rows={schema:3,revision:'r',platform:'linux',phase:'*',total:0,nextOffset:null,contracts:[],configurations:[],sources:[],sampling:[],capturedAt:[],rows:[]};
 const request=vi.fn(async(resource:string|URL|Request)=>{
  const url=new URL(String(resource),'https://example.test');
  if(url.pathname==='/api/summary')return Response.json({revision:'r',platforms:[platform]});
  if(url.pathname==='/api/aggregates')return Response.json({items:[]});
  return Response.json(rows);
 });
 vi.stubGlobal('fetch',request);
 const {bakePageSeed,activatePageSeed,connectSite,closeSite}=await import('./controller.svelte');
 const {encodeBakedSeed,decodeBakedSeed}=await import('./baked-codec');
 const seed=decodeBakedSeed(encodeBakedSeed(await bakePageSeed('https://example.test','/benchmarks/')));
 closeSite();request.mockClear();
 vi.stubGlobal('window',{});vi.stubGlobal('location',{pathname:'/benchmarks/',href:'https://example.test/benchmarks/'});
 activatePageSeed(seed);
 await connectSite();
 expect(request).not.toHaveBeenCalled();
 closeSite();
});
