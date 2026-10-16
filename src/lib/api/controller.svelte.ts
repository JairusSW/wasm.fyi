import {isLocalComparison} from '../local-comparison';
import {CompactClient} from './compact-client';
import {apiHistory,historyKey,type Timeline} from './history.svelte';
import {historyFactor,scaledChange,type HistoricalSummary,type HistoricalComparison,type HistoricalReport} from './compact-history';
import {unpackMatrixAsync,type CompactMatrix,type ScalarResult,type CompactAggregate} from './compact-matrix';
import {computationCheckpoint} from '../computation';
import {datasetView,emptyView,viewData} from './view.svelte';
import {ui} from '../state.svelte';
import {CFG,CB,RTS,RTB,runtimeRegistry,WF,sortCFG} from '../data/runtimes';
import {legacySlots} from './catalog';
import type {CfgId,MachineId,MetricKey,OtMetricKey,Cfg,Bench} from '../data/types';
import type {Scope} from '../model';
import type {SiteDataset,MatrixPage} from './site-data';
import type {Overview} from './types';
import type {PageSeed} from './page-seed';
import type {Result,PlatformChoice,BenchmarkPage,PlatformList} from './benchmark-types';
import type {ViewCell} from './view-contract';
import {shortVersion} from '../version-identity';
import {selectEngineVersions} from '../latency';
import {platformGroups} from './platform-groups';
import {machineLabel} from './machine-label';
import {featureResults} from './feature-results';
export type PageScope={machine:MachineId;snapshot:'s1'|'s2';metric:MetricKey;hide:Partial<Record<CfgId,boolean>>;baseline:CfgId;weighting:'corpus'|'workload';cohortMode?:'shared'|'per-engine';average?:'geo'|'mean';search?:string;tag?:string|null;sortBy?:{id:CfgId;dir:1|-1}|null;workload?:string};
export const apiView=$state({phaseLoading:false,serverAggregates:false,ready:false,loading:false,error:'',pageLoading:false,pageError:'',page:null as MatrixPage|null,cursors:[''],pageIndex:0,aggregates:{} as Record<string,Overview>,aggregateErrors:{} as Record<string,string>,coverage:{} as Partial<Record<CfgId,[number,number,number,number,number]>>,precomputed:{} as Record<string,CompactAggregate>,historyRevision:'',historyLoading:false,historyLoaded:{} as Partial<Record<MachineId,boolean>>});
/** History arrives after the main dataset; true while the selected machine's history is still on its way. */
export const historyPending=(machine:MachineId)=>!apiView.ready||(apiView.historyLoading&&!apiView.historyLoaded[machine]);
export const aggregateKey=(scope:Scope,metric:string)=>JSON.stringify([scope.machine,scope.snapshot||'s1',scope.baseline,scope.weighting,scope.cohortMode||'shared',scope.average||'geo',Object.keys(scope.hide).filter(k=>scope.hide[k as CfgId]).sort(),metric]);
let abort:AbortController|undefined;
let machines:MachineId[]=[];
const slots=new Map<string,CfgId>();
const plannedBackends:Record<string,string>={'wasmtime-winch':'winch','wasmer-llvm':'llvm-jit','wasmer-singlepass':'singlepass-jit','wasmer-cranelift':'cranelift-jit','chicory-jit':'jvm-bytecode-compiler','endive-interpreter':'jvm-interpreter','endive-jit':'jvm-bytecode-compiler','endive-redline':'cranelift-aot','wazy':'native-jit','chasm':'jvm-interpreter','wizard-v3-int':'v3-interpreter','wizard-fast-int':'fast-interpreter','wizard-spc':'spc','graalwasm':'truffle-graal','zwasm-interpreter':'interpreter','zwasm-jit':'jit','wazero-interpreter':'interpreter','wamr':'interpreter','wamr-fast-jit':'fast-jit','wamr-llvm-jit':'llvm-jit','wasmedge':'interpreter','wasmedge-jit':'jit','wasmi':'interpreter','wasm3':'interpreter','chicory':'interpreter','wasm2c-gcc':'GCC','w2c2-gcc':'GCC','wasm2go':'native-go-aot','jsc':'OMG (forced tier-up)','libwasm':'interpreter','spidermonkey':'ion-only'};
const status=(s:string):ViewCell['st']=>s==='not-measured'?'nm':s==='unavailable'?'unavail':s as ViewCell['st'];
function engineColor(engine:string){let hash=0;for(const c of engine)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;return `hsl(${hash%360} 65% 60%)`;}
function slot(engine:string):CfgId{
 const previous=slots.get(engine);if(previous)return previous;
 let id=Object.entries(legacySlots).find(([_,v])=>v===engine)?.[0] as CfgId|undefined;
 if(isLocalComparison(engine))id=`engine:${engine}`;
 if(engine==='wago-main')id='G';
 if(engine==='wago-beta.12')id='B';
 if(engine==='wago-beta.11')id='C';
 if(!id){const available='HIJKMNOPQRS'.split('').find(c=>!CFG.some(x=>x.id===c));id=available?available as CfgId:`engine:${engine}`}
 if(!CFG.some(c=>c.id===id)){
  const runtime=engine.startsWith('wago-')?'wago':engine.startsWith('wasmtime-')?'wasmtime':engine.startsWith('wasmer-')?'wasmer':engine.startsWith('wazero-')?'wazero':engine.startsWith('wamr-')?'wamr':engine.startsWith('wasmedge-')?'wasmedge':engine.startsWith('chicory-')?'chicory':engine.startsWith('endive-')?'endive':engine.startsWith('wizard-')?'wizard':engine.startsWith('zwasm-')?'zwasm':engine.endsWith('-gcc')?engine.slice(0,-4):engine;
  const template=CFG.find(c=>c.rt===runtime);
  const known=runtimeRegistry.find(r=>r.id===runtime);if(known&&!RTB[runtime]){RTS.push(known);RTB[runtime]=known}
  const cfg={...template,id,rt:runtime,ver:'not collected',be:plannedBackends[engine]||'',kind:'',col:engineColor(engine),hollow:engine==='wago-beta.11',interp:/interpreter/.test(plannedBackends[engine]||''),label:plannedBackends[engine]||''} as Cfg;
  Object.defineProperty(cfg,'ver',{enumerable:true,get:()=> (viewData.hosts.m1.configurations[cfg.id]||viewData.hosts.m2.configurations[cfg.id]||viewData.hosts.m3.configurations[cfg.id])?.version?shortVersion((viewData.hosts.m1.configurations[cfg.id]||viewData.hosts.m2.configurations[cfg.id]||viewData.hosts.m3.configurations[cfg.id])!.version):'not collected'});
  Object.defineProperty(cfg,'be',{enumerable:true,get:()=> (viewData.hosts.m1.configurations[cfg.id]||viewData.hosts.m2.configurations[cfg.id]||viewData.hosts.m3.configurations[cfg.id])?.backend||plannedBackends[engine]||''});
  CFG.push(cfg);sortCFG();
 }
 WF[id]=1;slots.set(engine,id);return id;
}
for(const engine of ['wago','wasmtime','wasmtime-winch','wasmer-singlepass','wasmer-llvm','wazero','wazero-interpreter','v8','wavm','spidermonkey','jsc','wasmi','wamr','wamr-fast-jit','wamr-llvm-jit','wasm3','wasmedge','wasmedge-jit','chicory','wasm2go','wasm2c-gcc','w2c2-gcc','libwasm','wasmer-cranelift','chicory-jit','endive-interpreter','endive-jit','endive-redline','wazy','chasm','wizard-v3-int','wizard-fast-int','wizard-spc','graalwasm','zwasm-interpreter','zwasm-jit'])slot(engine);
let compactClient=new CompactClient();
async function get<T>(path:string,signal:AbortSignal,revalidate=false):Promise<T>{return compactClient.load<T>(path,signal,revalidate)}
async function rows(platform:string,phase:string,signal:AbortSignal,history=false,corpus='',phases:string[]=[],delta=false){
 let limit=phase==='*'?16384:4096;
 for(let attempt=0;;attempt++){
  const all:ScalarResult[]=[];let offset=0;let revision='';let dataRevision:string|undefined;let activeVersions=true;
  try{do{
   const query=new URLSearchParams({platform,...(phase==='*'?{}:{phase}),limit:String(limit),...(corpus?{corpus}:{}),...(phases.length?{phases:phases.join(',')}:{}),...(delta?{delta:'1'}:{}),...(offset?{offset:String(offset),revision}:{})});
   const page=await get<CompactMatrix>((history?'/api/timeline?':phase==='*'?'/api/table?':'/api/matrix?')+query,signal);
   if(dataRevision&&page.dataRevision&&dataRevision!==page.dataRevision)throw Object.assign(Error('Data changed during loading'),{status:409});dataRevision=page.dataRevision;activeVersions=activeVersions&&page.schema===4;
   all.push(...await unpackMatrixAsync(page,signal));revision=page.revision;offset=page.nextOffset??0;
   if(all.length>1000000)throw Error('Measurement scope exceeds display limit');
  }while(offset);return Object.assign(all.filter(row=>!['wasm2js','deno','wasm2rs'].includes(row.engine)),{dataRevision,activeVersions});
  }catch(error){if((error as {status?:number}).status===422&&phase==='*'&&limit>256){limit=Math.floor(limit/2);signal.throwIfAborted();continue;}if((error as {status?:number}).status!==409||attempt>=3)throw error;compactClient.invalidate();signal.throwIfAborted();}
 }
}
type Summary={revision:string;platforms:(PlatformChoice&{capturedAt?:string;importedAt?:string;revision?:string;latestRevision?:string;historyRevision?:string;latestRows?:number;latestTimingSamples?:number;allTimingSamples?:number})[]};
let summary:Summary|undefined;
let summaryCheckedAt=0;
const metadataMachines=new Map<MachineId,string>();
const machineRevision=(machine:MachineId,value=summary)=>JSON.stringify(platformTargets.find(target=>target.machine===machine)?.platforms.map(id=>{const p=value?.platforms.find(p=>p.id===id);return p?.latestRevision||p?.revision||value?.revision}));
const loadedMachines=new Map<MachineId,string>();
const loadedPhases=new Map<MachineId,Set<string>>();
const phaseNames=['compile','instantiate','first-call','steady'];
function wantedMainPhases(){
 const phases=new Set(['compile','steady']);
 const ofMetric=(metric:string)=>(({compile:'compile',rssCompile:'compile',inst:'instantiate',rssInst:'instantiate',first:'first-call'} as Record<string,string>)[metric]||'steady');
 phases.add(ofMetric(ui.metric));
 const drawer=ui.drawer;
 if(drawer?.type==='cell')phases.add(ofMetric(drawer.m));
 if(drawer?.type==='aggregate'){
  if(drawer.group==='lat')phases.add(phaseNames[drawer.col]||'steady');
  if(drawer.group==='mem')for(const p of drawer.col===3?phaseNames:[['compile','instantiate','steady'][drawer.col]||'steady'])phases.add(p);
 }
 return phaseNames.filter(p=>phases.has(p));
}
let platformTargets:{platforms:string[];machine:MachineId}[]=[];
let historyAbort:AbortController|undefined;
let historyScope='';
function historicalQuery(scope:PageScope,metric:OtMetricKey,workload=''){
 const target=platformTargets.find(target=>target.machine===scope.machine);if(!target)return null;
 const engines=[...slots].filter(([,id])=>!scope.hide[id]&&!!viewData.hosts[scope.machine].configurations[id]).map(([engine])=>engine);
 return new URLSearchParams({platform:target.platforms[0],platforms:target.platforms.join(','),metric,engines:engines.join(','),baseline:trackId(scope.baseline)||'',weighting:scope.weighting,cohort:scope.cohortMode||'shared',average:scope.average||'geo',from:apiHistory.from,to:apiHistory.until,...(workload?{workload}:{})});
}
function rememberHistoryChange(key:string,change:import('./compact-history').HistoricalChange,metric:OtMetricKey){
 const value=scaledChange(change,metric);if(!value||!change.fromDate||!change.toDate)return;
 apiHistory.changes[JSON.stringify([key,slot(change.engine),change.fromDate,change.toDate])]=value;
}
function registerHistoricalSummary(scope:PageScope,result:HistoricalSummary,workload=''){
 const key=historyKey(scope,result.metric,workload);
  const history=emptyView().history[scope.machine];history.workloads=result.workloads||[];
  const timeline:Timeline={revision:result.revision,items:[],changes:[],reference:history.workloads.length,policy:'Fixed current reference cohort; matched comparisons',timeAxis:'source snapshot date',uncertainty:'Not inferred'};
  for(const point of result.items){
   const releases:NonNullable<typeof history.points[number]['releases']>={};
   const lanes:Timeline['items'][number]['lanes']=[];
   for(const lane of point.lanes){
    const cid=slot(lane.engine);apiHistory.slots[cid]=lane.engine;
    const version=lane.source?.kind==='release'?(lane.source.ref||lane.version):lane.source?.revision||lane.version;
    history.versions[cid]||=result.items.map(()=> 'not collected');history.versions[cid][timeline.items.length]=version;
    history.sources||={};history.sources[cid]||=result.items.map(()=>undefined);history.sources[cid]![timeline.items.length]=lane.source;
    if(lane.source?.kind==='release')releases[cid]={version,publishedAt:point.date,url:lane.source.repository};
    lanes.push({track:lane.engine,calls:lane.calls,value:lane.value,measured:lane.count,reference:lane.reference,version,configuration:lane.engine,collectedAt:lane.latestCreated,role:'retrospective-revision',release:null,sourceReports:0,reports:[],evidence:lane.fingerprint});
    if(lane.previous)rememberHistoryChange(key,{...lane.previous,engine:lane.engine},result.metric);if(lane.first)rememberHistoryChange(key,{...lane.first,engine:lane.engine},result.metric);
   }
   history.points.push({date:point.date,revision:result.revision,status:'measured',...(Object.keys(releases).length?{releases}:{})});
   timeline.items.push({date:point.date,lanes});
  }

 apiHistory.series[key]=timeline;apiHistory.active[scope.machine+'|'+result.metric]=key;apiHistory.captureDates[scope.machine+'|'+result.metric+'|'+workload]=result.items.map(p=>p.date);
 return history;
}
async function refreshHistory(scope:PageScope,metric:OtMetricKey,workload=''){
 const query=historicalQuery(scope,metric,workload);if(!query)return;
 const key=historyKey(scope,metric,workload);
 const requestScope=JSON.stringify([key,query.get('platforms'),query.get('platforms')!.split(',').map(id=>{const p=summary?.platforms.find(p=>p.id===id);return [p?.latestRevision,p?.historyRevision]})]);if(historyScope===requestScope)return;
 historyAbort?.abort();apiView.historyLoading=true;apiHistory.loading=true;apiHistory.error='';historyAbort=new AbortController();const signal=historyAbort.signal;
 apiView.historyLoaded[scope.machine]=false;
 try{
  const result=await get<HistoricalSummary>('/api/history/summary?'+query,signal);signal.throwIfAborted();
  const history=registerHistoricalSummary(scope,result,workload);
  if(metric==='cov'){const extra=new URLSearchParams(query);extra.set('metric','exec');const execution=await get<HistoricalSummary>('/api/history/summary?'+extra,signal);signal.throwIfAborted();registerHistoricalSummary(scope,execution,workload)}
  const previousEnd=Math.max(0,datasetView.current.history[scope.machine].points.length-1),followEnd=ui.histTo>=previousEnd;
  apiHistory.compact=true;
  const keys=Object.keys(apiHistory.series);while(keys.length>24){const oldest=keys.shift()!;delete apiHistory.series[oldest];for(const change of Object.keys(apiHistory.changes))if(JSON.parse(change)[0]===oldest)delete apiHistory.changes[change]}
  datasetView.current={...datasetView.current,history:{...datasetView.current.history,[scope.machine]:history}};datasetView.generation++;
  apiView.historyLoaded[scope.machine]=true;historyScope=requestScope;
  if(scope.machine===ui.machine){const end=Math.max(0,history.points.length-1);ui.histTo=followEnd?end:Math.min(ui.histTo,end);ui.histFrom=Math.min(ui.histFrom,ui.histTo)}
 }catch(error){if(!signal.aborted){apiHistory.error=String(error);apiView.aggregateErrors.history=String(error)}}finally{if(!signal.aborted){apiView.historyLoading=false;apiHistory.loading=false}}
}
let comparisonAbort:AbortController|undefined;
let comparisonScope='';
export async function loadHistoryComparison(scope:PageScope,metric:OtMetricKey,fromDate:string,toDate:string,workload=''){
 if(!fromDate||!toDate||fromDate===toDate)return;
 const query=historicalQuery(scope,metric,workload);if(!query)return;
 const key=historyKey(scope,metric,workload),revision=apiHistory.series[key]?.revision;if(!revision)return;
 const requestScope=JSON.stringify([key,revision,fromDate,toDate]);if(comparisonScope===requestScope)return;
 comparisonAbort?.abort();comparisonAbort=new AbortController();const signal=comparisonAbort.signal;
 query.set('fromDate',fromDate);query.set('toDate',toDate);
 try{const result=await get<HistoricalComparison>('/api/history/comparison?'+query,signal);signal.throwIfAborted();if(result.revision!==revision){historyScope='';await refreshHistory(scope,metric,workload);return}for(const change of result.items)rememberHistoryChange(key,change,metric);comparisonScope=requestScope}
 catch(error){if(!signal.aborted)apiHistory.error=String(error)}
}
export async function connectSite(_origin='',_revision?:string,retry=0){
 abort?.abort();abort=new AbortController();const signal=abort.signal;apiView.loading=true;apiView.error='';
 try{
  const checkpoint=computationCheckpoint(signal);
  const refresh=!summary||Date.now()-summaryCheckedAt>15000;
  const fresh=await get<Summary>('/api/summary',signal,refresh);
  if(refresh)summaryCheckedAt=Date.now();
  if(summary&&summary.revision!==fresh.revision){
   for(const p of fresh.platforms){const previous=summary.platforms.find(old=>old.id===p.id);
    const latestChanged=(previous?.latestRevision||previous?.revision||summary.revision)!==(p.latestRevision||p.revision||fresh.revision);
    const historyChanged=(previous?.historyRevision||previous?.revision||summary.revision)!==(p.historyRevision||p.revision||fresh.revision);
    compactClient.invalidate(path=>{const url=new URL(path,'http://localhost');return (url.searchParams.get('platform')===p.id||(url.searchParams.get('platforms')?.split(',').includes(p.id)??false))&&(url.pathname==='/api/timeline'?historyChanged:url.pathname.startsWith('/api/history/')?(historyChanged||latestChanged):latestChanged&&url.pathname!=='/api/observation')});
    if(latestChanged)for(const [key,result] of Object.entries(apiView.precomputed))if(result.platform===p.id)delete apiView.precomputed[key];
   }
  }
  summary=fresh;apiView.historyRevision=fresh.revision;
  const platforms:PlatformList={revision:fresh.revision,items:fresh.platforms};
  platformTargets=platformGroups(platforms.items).map(group=>({machine:group.machine,platforms:group.platforms.map(p=>p.id)}));
  machines=platformTargets.map(group=>group.machine);
  if(!machines.includes(ui.machine)&&machines.length)ui.machine=machines[0];
  const light=typeof location!=='undefined'&&['/','/health','/health/','/history','/history/'].includes(location.pathname)&&!ui.drawer;
  const selectedRevision=machineRevision(ui.machine,fresh);
  const pathname=typeof location==='undefined'?'':location.pathname.replace(/\/$/,'');
  const corpus=pathname==='/benchmarks'?'main':pathname==='/features'?'features':'';
  const captureRevision=selectedRevision+'|'+corpus;
  datasetView.current.statistics.timingSamples=fresh.platforms.reduce((n,p)=>n+(p.latestTimingSamples||0),0);
  datasetView.current.statistics.allTimingSamples=fresh.platforms.reduce((n,p)=>n+(p.allTimingSamples||0),0);
  for(const target of platformTargets){const p=fresh.platforms.find(p=>p.id===target.platforms[0]);if(p){const host=datasetView.current.hosts[target.machine];host.capturedAt=p.capturedAt;host.importedAt=p.importedAt;host.latestRows=p.latestRows}}
  if(light){
   if(metadataMachines.get(ui.machine)===selectedRevision){apiView.ready=true;return}
   const view={...datasetView.current,hosts:{...datasetView.current.hosts},reports:{...datasetView.current.reports},statistics:{...datasetView.current.statistics}};
   for(const {machine,platforms:group} of platformGroups(platforms.items)){
    const p=group[0] as Summary['platforms'][number];view.hosts[machine]={...view.hosts[machine],label:machineLabel(p.cpu),os:`${p.os}/${p.arch} · ${p.kernel}`,policy:{cores:String(p.cores),memory:p.memoryBytes?`${(p.memoryBytes/1024**3).toFixed(1)} GiB`:'not collected'},capturedAt:p.capturedAt,importedAt:p.importedAt,latestRows:p.latestRows};
   }
   const platform=platformTargets.find(target=>target.machine===ui.machine)!.platforms[0];
   const metadata=await get<CompactAggregate>('/api/aggregates?'+new URLSearchParams({platform,metric:'steady'}),signal);
   const host=view.hosts[ui.machine];host.configurations={};
   for(const card of metadata.cards){const cid=slot(card.engine),cfg=CFG.find(cfg=>cfg.id===cid)!;CB[cid]=cfg;view.configurations[cid]=card.engine;host.configurations[cid]={runtime:cfg.rt,version:card.version,backend:card.backend,source:card.source};if(card.latestCreated){const report=card.latestCreated+'|'+card.engine;view.reports[report]={runId:report,created:card.latestCreated,evidence:'',sha256:'',options:{},codeRecords:[],configurations:[card.engine],host:ui.machine}}}
   view.applicationConfigurations=[...slots.values()];view.statistics={...view.statistics,machines:platformTargets.length,measuredWorkloads:metadata.workloads?.length,timingSamples:fresh.platforms.reduce((n,p)=>n+(p.latestTimingSamples||0),0),allTimingSamples:fresh.platforms.reduce((n,p)=>n+(p.allTimingSamples||0),0)};
   signal.throwIfAborted();datasetView.current=view;datasetView.generation++;metadataMachines.set(ui.machine,selectedRevision);apiView.ready=true;
   if(typeof location==='undefined'||!location.pathname.startsWith('/history'))await loadOverview({...ui.scope,machine:ui.machine,snapshot:ui.snap,metric:ui.metric},'steady','',signal);return;
  }
  const reuse=loadedMachines.get(ui.machine)===captureRevision;
  const wanted=corpus==='main'?wantedMainPhases():phaseNames;
  const previousPhases=reuse?loadedPhases.get(ui.machine):undefined;
  if(reuse&&wanted.every(p=>previousPhases?.has(p))){apiView.serverAggregates=pathname==='/benchmarks';apiView.ready=true;return}
  const missing=corpus==='main'?wanted.filter(p=>!previousPhases?.has(p)):[];
  apiView.phaseLoading=apiView.ready;
  const view={...datasetView.current,hosts:{...datasetView.current.hosts},reports:{...datasetView.current.reports},featureVersions:{...datasetView.current.featureVersions}};const catalogue=new Map<string,Bench>();const historyTargets:{platforms:string[];machine:MachineId}[]=[];let timingSamples=0;let timingSamplesComplete=true;
  for(const {machine,platforms:group} of platformGroups(platforms.items)){
   const platform=group[0];
   const host=(machine===ui.machine?{...view.hosts[machine],configurations:reuse?{...view.hosts[machine].configurations}:{},snapshots:reuse?{s1:{...view.hosts[machine].snapshots.s1},s2:{...view.hosts[machine].snapshots.s2}}:{s1:{},s2:{}}}:{...view.hosts[machine]}) as typeof view.hosts[MachineId];
   view.hosts[machine]=host;host.capturedAt=(platform as Summary['platforms'][number]).capturedAt;host.importedAt=(platform as Summary['platforms'][number]).importedAt;host.latestRows=(platform as Summary['platforms'][number]).latestRows;host.label=machineLabel(platform.cpu);host.os=`${platform.os}/${platform.arch} · ${platform.kernel}`;host.policy={cores:String(platform.cores),memory:platform.memoryBytes?`${(platform.memoryBytes/1024**3).toFixed(1)} GiB`:'not collected'};
   if(machine!==ui.machine)continue;
   view.featureVersions[machine]=[];
   const normalize=(row:ScalarResult):ScalarResult=>row.engine.startsWith('wago-')&&!isLocalComparison(row.engine)?{...row,engine:'wago'}:row;
   const current=await Promise.all(group.map(platform=>rows(platform.id,'*',signal,false,corpus,missing,reuse&&corpus==='main')));
   if(current.some((rows,i)=>rows.dataRevision&&rows.dataRevision!==(group[i] as Summary['platforms'][number]).latestRevision))throw Object.assign(Error('Dataset changed while loading'),{changed:true});
   const raw=current.flat().map(normalize);
   // Schema 4 already selected each engine's current snapshot. Multiple physical
   // platform records still need a merged selection, as do older API servers.
   const all=current.length===1&&current[0].activeVersions?raw:[...selectEngineVersions(raw.filter(row=>!row.workload.startsWith('features/'))),...selectEngineVersions(raw.filter(row=>row.workload.startsWith('features/')))] as ScalarResult[];
   historyTargets.push({platforms:group.map(p=>p.id),machine});
   if(reuse)for(const b of view.catalogue)catalogue.set(b.id,b);
   const phases=new Map<string,Set<string>>();
   for(const row of all){const key=JSON.stringify([row.engine,row.workload]);const set=phases.get(key)||new Set<string>();set.add(row.phase);phases.set(key,set);const pause=checkpoint();if(pause)await pause;}
   for(const row of all){
    const pause=checkpoint();if(pause)await pause;
    if(row.latencyStatus==='ok'){if(row.samplesNs?.length||row.timingSamples)timingSamples+=row.samplesNs?.length||row.timingSamples||0;else timingSamplesComplete=false;}
    const cid=slot(row.engine);const cfg=CFG.find(c=>c.id===cid)!;CB[cid]=cfg;if(!host.configurations[cid]||!reuse&&!row.workload.startsWith('features/'))host.configurations[cid]={runtime:cfg.rt,version:row.engine.startsWith('wago-')&&!isLocalComparison(row.engine)?row.engine.slice(5)+' · '+row.version:row.version,backend:row.backend,source:row.source};view.configurations[cid]=row.engine;
    const report=row.capturedAt+'|'+row.engine;view.reports[report]={runId:report,created:row.capturedAt,evidence:'',sha256:'',options:{},codeRecords:[],configurations:[row.engine],host:machine};
    // Host-call mechanism workloads feed the call-latency view only; they are not listed as workloads.
    if(!row.workload.startsWith('mechanisms/')&&!catalogue.has(row.workload))catalogue.set(row.workload,{id:row.workload,artifactSha256:row.artifactSha256,baseline:row.display?.tags?.includes('baseline'),tags:row.display?.tags||[],kb:row.display?.bytes?row.display.bytes/1024:null,ms:null,group:row.display?.group||(row.workload.startsWith('mechanisms/')?'Host calls':row.workload.split('/')[1]||'Other workloads'),purpose:row.display?.purpose||row.wasm,abi:row.display?.abi||'',src:row.display?.source,reset:row.display?.reset,evidenceScope:phases.get(JSON.stringify([row.engine,row.workload]))?.has('steady')?'execution':phases.get(JSON.stringify([row.engine,row.workload]))?.has('instantiate')?'compile-and-instantiate':'compile-only'});
    const base={report,created:row.capturedAt,contract:row.contractSha256,configuration:row.engine,observationId:row.observationId,platformId:row.platformId,asOf:row.source?.asOf};
    const phase=({compile:'compile',instantiate:'inst','first-call':'first',steady:'steady'} as const)[row.phase];
    host.snapshots.s1[`${row.workload}|${cid}|${phase}`]={...base,latencySummary:row.latencySummary,...(row.sampleStats?{sampleStats:{count:row.sampleStats.count,mean:row.sampleStats.mean/1e6,stdDev:row.sampleStats.stdDev==null?null:row.sampleStats.stdDev/1e6,min:row.sampleStats.min/1e6,max:row.sampleStats.max/1e6}}:{}),sampling:row.sampling,samples:row.samplesNs?.map(value=>value/1e6),st:status(row.latencyStatus),...(row.latencyNs!=null?{v:row.latencyNs/1e6}:{})};
    const memory=({compile:'rssCompile',instantiate:'rssInst','first-call':'rssFirst',steady:'rss'} as const)[row.phase];
    host.snapshots.s1[`${row.workload}|${cid}|${memory}`]={...base,st:status(row.memoryStatus),...(row.peakRssBytes!=null?{v:row.peakRssBytes/1024**2}:{})};
    const codeKey=`${row.workload}|${cid}|code`,oldCode=host.snapshots.s1[codeKey];
    const oldPhase=['compile','inst','first','steady'].findIndex(p=>oldCode?.observationId!=null&&host.snapshots.s1[`${row.workload}|${cid}|${p}`]?.observationId===oldCode.observationId);
    if(phaseNames.indexOf(row.phase)>=oldPhase)host.snapshots.s1[codeKey]={...base,st:status(row.codeStatus),...(row.codeBytes!=null?{v:row.codeBytes/1024}:{})};
   }
   for(const engine of new Set(all.filter(r=>r.workload.startsWith('features/')).map(r=>r.engine))){
    const measurements=all.filter(r=>r.engine===engine&&r.workload.startsWith('features/'));
    const first=measurements[0],cid=slot(engine),runtime=CFG.find(c=>c.id===cid)!.rt;
    const features=featureResults(measurements);
    view.featureVersions[machine].push({id:engine,identity:first.version,channel:first.source?.kind==='release'?'stable':'development',version:first.source?.ref||first.version,source:first.source?.repository||'',revision:first.source?.revision||null,collectedAt:measurements.map(r=>r.capturedAt).sort().at(-1)!,description:{runtime,runtime_version:first.version,backend:first.backend,source:first.source},features});
   }
   view.history[machine]=datasetView.current.history[machine];

  }
  if(signal.aborted)return;
  view.catalogue=[...new Map([...view.catalogue,...catalogue.values()].map(b=>[b.id,b])).values()];view.applicationConfigurations=[...new Set([...slots.values()])];view.statistics={machines:platformTargets.length,timingSamples:fresh.platforms.reduce((n,p)=>n+(p.latestTimingSamples||0),0),allTimingSamples:fresh.platforms.reduce((n,p)=>n+(p.allTimingSamples||0),0)};
  if(!apiView.ready&&typeof location!=='undefined'){const shown=new URL(location.href).searchParams.get('rt');if(shown){const ids=shown.split(',');ui.hide=Object.fromEntries(CFG.map(c=>[c.id,!ids.includes(c.id)]));}}
  if(pathname==='/benchmarks'){
   try{await loadOverviews({...ui.scope,machine:ui.machine,snapshot:ui.snap,metric:ui.metric},['compile','inst','first','steady','rssCompile','rssInst','rss','rssAverage','code'],signal,view,(fresh.platforms.find(p=>p.id===platformTargets.find(t=>t.machine===ui.machine)?.platforms[0]))?.latestRevision)}
   catch(error){signal.throwIfAborted();if((error as {changed?:boolean}).changed)throw error;for(const metric of ['compile','inst','first','steady','rssCompile','rssInst','rss','rssAverage','code'])apiView.aggregateErrors[aggregateKey(ui.scope,metric)]=String(error)}
  }
  signal.throwIfAborted();apiView.serverAggregates=pathname==='/benchmarks';
  datasetView.current=view;sortCFG();datasetView.revision='';datasetView.generation++;apiView.ready=true;loadedMachines.set(ui.machine,captureRevision);loadedPhases.set(ui.machine,new Set([...(previousPhases||[]),...wanted]));
  if(!machines.includes(ui.machine)&&machines.length)ui.machine=machines[0];datasetView.machine=ui.machine;
 }catch(error){if(!signal.aborted&&(error as {changed?:boolean}).changed&&retry<2){summaryCheckedAt=0;loadedMachines.delete(ui.machine);compactClient.invalidate();return connectSite(_origin,_revision,retry+1)}if(!signal.aborted)apiView.error=String(error)}finally{if(!signal.aborted){apiView.loading=false;apiView.phaseLoading=false}}
}
export async function loadCellSamples(machine:MachineId,snapshot:'s1'|'s2',workload:string,cid:CfgId,metric:MetricKey,signal:AbortSignal){
 const cell=datasetView.current.hosts[machine].snapshots[snapshot][`${workload}|${cid}|${metric}`];
 if(!cell?.observationId||!cell.platformId||cell.samples||!['compile','inst','first','steady'].includes(metric))return;
 const query=new URLSearchParams({platform:cell.platformId,id:String(cell.observationId),...(cell.asOf?{asOf:cell.asOf}:{})});
 const result=await get<Result>('/api/observation?'+query,signal);
 signal.throwIfAborted();
 const current=datasetView.current,host=current.hosts[machine],key=`${workload}|${cid}|${metric}`;
 if(host.snapshots[snapshot][key]?.observationId!==cell.observationId)return;
 const updated={...cell,samples:result.samplesNs?.map(value=>value/1e6),sampling:result.sampling};
 datasetView.current={...current,hosts:{...current.hosts,[machine]:{...host,snapshots:{...host.snapshots,[snapshot]:{...host.snapshots[snapshot],[key]:updated}}}}};
}
export function firstMachine(){return machines[0]}
export function activatePageSeed(_seed:PageSeed){}
export async function loadPage(_scope:PageScope,_index=0,_append=false){}
export async function loadCalls(_scope:PageScope){}
export async function loadWorkload(_scope:PageScope){}
export async function loadFeatures(_scope:PageScope,_feature?:string,_configuration?:string){}
export async function loadHistory(scope:PageScope,metric:OtMetricKey,workload='',_before?:string,_after?:string){await refreshHistory(scope,metric,workload)}
export async function loadProposal(_scope:PageScope,_feature:string){}
let reportAbort:AbortController|undefined;
export async function loadHistoryReport(scope:PageScope,metric:OtMetricKey,cid:CfgId,before:string,after:string,_cursor=''){
 const query=historicalQuery(scope,metric),engine=trackId(cid);if(!query||!engine||!before||!after)return;
 const timelineKey=historyKey(scope,metric),revision=apiHistory.series[timelineKey]?.revision;if(!revision)return;
 const key=JSON.stringify([timelineKey,cid,before,after,revision]);if(apiHistory.reportKey===key)return;
 reportAbort?.abort();reportAbort=new AbortController();const signal=reportAbort.signal;apiHistory.reportLoading=true;apiHistory.reportError='';
 query.set('engine',engine);query.set('fromDate',before);query.set('toDate',after);
 try{
  const result=await get<HistoricalReport>('/api/history/report?'+query,signal);signal.throwIfAborted();
  if(result.revision!==revision){historyScope='';await refreshHistory(scope,metric);return}
  apiHistory.compactReport=result;apiHistory.reportKey=key;
 }catch(error){if(!signal.aborted)apiHistory.reportError=String(error)}finally{if(!signal.aborted)apiHistory.reportLoading=false}
}

export async function loadOverview(scope:PageScope,metric:MetricKey|'rssAverage',feature='',signal?:AbortSignal){
 if(feature)return;await loadOverviews(scope,[metric],signal);
}
export async function loadOverviews(scope:PageScope,metrics:(MetricKey|'rssAverage')[],signal?:AbortSignal,preparedView?:typeof datasetView.current,expectedRevision?:string){
 scope={...scope,hide:{...scope.hide}};
 const target=platformTargets.find(target=>target.machine===scope.machine);if(!target||!metrics.length)return;
 const source=preparedView||viewData;const variants=metrics.length>1?['geo','mean'] as const:[scope.average||'geo'];
 if(metrics.every(metric=>variants.every(average=>!!apiView.precomputed[aggregateKey({...scope,average:average as 'geo'|'mean'},metric)]&&(!expectedRevision||apiView.precomputed[aggregateKey({...scope,average:average as 'geo'|'mean'},metric)].revision===expectedRevision))))return;
 const engines=[...slots].filter(([,id])=>!scope.hide[id]&&!!source.hosts[scope.machine].configurations[id]).map(([engine])=>engine);
 const query=new URLSearchParams({platform:target.platforms[0],...(metrics.length===1?{metric:metrics[0]}:{metrics:metrics.join(',')}),weighting:scope.weighting,cohort:scope.cohortMode||'shared',average:metrics.length>1?'both':scope.average||'geo',engines:engines.join(','),baseline:source.configurations[scope.baseline]||trackId(scope.baseline)||''});
 let results:CompactAggregate[]=[];
 for(let attempt=0;;attempt++){
  try{if(metrics.length===1)results=[await get<CompactAggregate>('/api/aggregates?'+query,signal||new AbortController().signal)];else results=(await get<{items:CompactAggregate[]}>('/api/aggregates?'+query,signal||new AbortController().signal)).items;break}
  catch(error){if((error as {status?:number}).status!==409||attempt>=2)throw error;signal?.throwIfAborted()}
 }
 if(signal?.aborted)return;
 if(expectedRevision&&results.some(r=>r.revision!==expectedRevision))throw Object.assign(Error('Dataset changed while preparing averages'),{changed:true});
 const reportView=preparedView||datasetView.current;
 for(const result of results){const key=aggregateKey({...scope,average:result.average||scope.average},result.metric);apiView.precomputed[key]=result;delete apiView.aggregateErrors[key];
  for(const card of result.cards){const report=(card.latestCreated||'')+'|'+card.engine;if(card.latestCreated&&!reportView.reports[report])reportView.reports[report]={runId:report,created:card.latestCreated,evidence:'',sha256:'',options:{},codeRecords:[],configurations:[card.engine],host:scope.machine}}
 }
 const keys=Object.keys(apiView.precomputed);while(keys.length>64)delete apiView.precomputed[keys.shift()!];
}

export function trackId(id:CfgId){return datasetView.current.configurations[id]}
export function resetPages(){apiView.cursors=[''];apiView.pageIndex=0}
export function currentClient():SiteDataset|null{return null}
export function closeSite(){abort?.abort();historyAbort?.abort();comparisonAbort?.abort();reportAbort?.abort();compactClient.close();compactClient=new CompactClient();apiView.serverAggregates=false;apiView.ready=false}
