import {datasetView,emptyView,viewData} from './view.svelte';
import {ui} from '../state.svelte';
import {CFG,CB,RTS,RTB,runtimeRegistry,WF} from '../data/runtimes';
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
export type PageScope={machine:MachineId;snapshot:'s1'|'s2';metric:MetricKey;hide:Partial<Record<CfgId,boolean>>;baseline:CfgId;weighting:'corpus'|'workload';cohortMode?:'shared'|'per-engine';search?:string;tag?:string|null;sortBy?:{id:CfgId;dir:1|-1}|null;workload?:string};
export const apiView=$state({ready:false,loading:false,error:'',pageLoading:false,pageError:'',page:null as MatrixPage|null,cursors:[''],pageIndex:0,aggregates:{} as Record<string,Overview>,aggregateErrors:{} as Record<string,string>,coverage:{} as Partial<Record<CfgId,[number,number,number,number,number]>>});
export const aggregateKey=(scope:Scope,metric:string)=>JSON.stringify([scope.machine,scope.snapshot||'s1',scope.baseline,scope.weighting,scope.cohortMode||'shared',Object.keys(scope.hide).filter(k=>scope.hide[k as CfgId]).sort(),metric]);
let abort:AbortController|undefined;
let machines:MachineId[]=[];
const slots=new Map<string,CfgId>();
const plannedBackends:Record<string,string>={'wasmtime-winch':'winch','wasmer-llvm':'llvm-jit','wasmer-singlepass':'singlepass-jit','wazero-interpreter':'interpreter','wamr':'interpreter','wamr-fast-jit':'fast-jit','wamr-llvm-jit':'llvm-jit','wasmedge':'interpreter','wasmedge-jit':'jit','wasmi':'interpreter','wasm3':'interpreter','chicory':'interpreter','wasm2c-gcc':'GCC','w2c2-gcc':'GCC','wasm2go':'Go compiler'};
const status=(s:string):ViewCell['st']=>s==='not-measured'?'nm':s as ViewCell['st'];
function engineColor(engine:string){let hash=0;for(const c of engine)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;return `hsl(${hash%360} 65% 60%)`;}
function slot(engine:string):CfgId{
 const previous=slots.get(engine);if(previous)return previous;
 let id=Object.entries(legacySlots).find(([_,v])=>v===engine)?.[0] as CfgId|undefined;
 if(engine==='wago-main')id='G';
 if(engine==='wago-beta.12')id='B';
 if(engine==='wago-beta.11')id='C';
 if(!id){const available='HIJKMNOPQRS'.split('').find(c=>!CFG.some(x=>x.id===c));id=available?available as CfgId:`engine:${engine}`}
 if(!CFG.some(c=>c.id===id)){
  const runtime=engine.startsWith('wago-')?'wago':engine.startsWith('wasmtime-')?'wasmtime':engine.startsWith('wasmer-')?'wasmer':engine.startsWith('wazero-')?'wazero':engine.startsWith('wamr-')?'wamr':engine.startsWith('wasmedge-')?'wasmedge':engine.endsWith('-gcc')?engine.slice(0,-4):engine;
  const template=CFG.find(c=>c.rt===runtime);
  const known=runtimeRegistry.find(r=>r.id===runtime);if(known&&!RTB[runtime]){RTS.push(known);RTB[runtime]=known}
  const cfg={...template,id,rt:runtime,ver:'not collected',be:plannedBackends[engine]||'',kind:'',col:engineColor(engine),hollow:engine==='wago-beta.11',interp:plannedBackends[engine]==='interpreter'} as Cfg;
  Object.defineProperty(cfg,'ver',{enumerable:true,get:()=> (viewData.hosts.m1.configurations[cfg.id]||viewData.hosts.m2.configurations[cfg.id]||viewData.hosts.m3.configurations[cfg.id])?.version?shortVersion((viewData.hosts.m1.configurations[cfg.id]||viewData.hosts.m2.configurations[cfg.id]||viewData.hosts.m3.configurations[cfg.id])!.version):'not collected'});
  Object.defineProperty(cfg,'be',{enumerable:true,get:()=> (viewData.hosts.m1.configurations[cfg.id]||viewData.hosts.m2.configurations[cfg.id]||viewData.hosts.m3.configurations[cfg.id])?.backend||plannedBackends[engine]||''});
  CFG.push(cfg);
 }
 WF[id]=1;slots.set(engine,id);return id;
}
for(const engine of ['wago','wasmtime','wasmtime-winch','wasmer-singlepass','wasmer-llvm','wazero','wazero-interpreter','v8','wavm','spidermonkey','jsc','wasmi','wamr','wamr-fast-jit','wamr-llvm-jit','wasm3','wasmedge','wasmedge-jit','chicory','wasm2go','wasm2c-gcc','w2c2-gcc','libwasm'])slot(engine);
async function get<T>(path:string,signal:AbortSignal):Promise<T>{
 for(let attempt=0;;attempt++){
  const response=await fetch(path,{signal});
  if((response.status===429||response.status===503)&&attempt<4){const seconds=Number(response.headers.get('Retry-After'));await new Promise(resolve=>setTimeout(resolve,Number.isFinite(seconds)&&seconds>0?Math.min(seconds,10)*1000:1000));signal.throwIfAborted();continue;}
  if(!response.ok){const body=await response.json().catch(()=>null);const error=Object.assign(Error(body?.error?.message||'Could not load measurements'),{status:response.status});throw error;}return response.json();
 }
}
async function rows(platform:string,phase:string,signal:AbortSignal,history=false){
 for(let attempt=0;;attempt++){
  const all:Result[]=[];let cursor:string|null=null;
  try{do{const page:BenchmarkPage=await get<BenchmarkPage>((history?'/api/history?':'/api/benchmarks?')+new URLSearchParams(cursor?{cursor,limit:'1000'}:{platform,phase,limit:'1000'}),signal);all.push(...page.items);cursor=page.nextCursor;if(all.length>1000000)throw Error('Measurement scope exceeds display limit');}while(cursor);return all.filter(row=>!['wasm2js','deno','wasm2rs'].includes(row.engine));}
  catch(error){if((error as {status?:number}).status!==409||attempt>=3)throw error;await new Promise(resolve=>setTimeout(resolve,500));signal.throwIfAborted();}
 }
}
let historyAbort:AbortController|undefined;
let historyBusy=false;
function fillHistory(view:ReturnType<typeof emptyView>,machine:MachineId,historical:Result[]){
   const daily=new Map<string,Result[]>();for(const row of historical){const key=(row.source?.asOf||row.capturedAt).slice(0,10);const bucket=daily.get(key)||[];bucket.push(row);daily.set(key,bucket)}
   historical=[...daily.values()].flatMap(bucket=>selectEngineVersions(bucket)).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
   const dates=[...new Set(historical.map(r=>(r.source?.asOf||r.capturedAt).slice(0,10)))].sort();
   const history=view.history[machine];history.points=dates.map(date=>({date,revision:'',status:'measured'}));history.workloads=[...new Set(historical.map(r=>r.workload))];
   for(const row of historical){const cid=slot(row.engine),index=dates.indexOf((row.source?.asOf||row.capturedAt).slice(0,10));const phase=({compile:'compile',instantiate:'inst','first-call':'first',steady:'steady'} as const)[row.phase];const memory=({compile:'rssCompile',instantiate:'rssInst','first-call':'rssFirst',steady:'rss'} as const)[row.phase];history.versions[cid]||=dates.map(()=> 'not collected');history.versions[cid][index]=row.source?.ref||row.version;history.sources||={} ;history.sources[cid]||=dates.map(()=>undefined);history.sources[cid][index]=row.source;history.artifactSha256[row.workload]=row.artifactSha256;
    const report=row.capturedAt+'|'+row.engine;view.reports[report]||={runId:report,created:row.capturedAt,evidence:'',sha256:'',options:{},codeRecords:[],configurations:[row.engine],host:machine};
    for(const [metric,value,measured,factor] of [[phase,row.latencyNs,row.latencyStatus,1e6],[memory,row.peakRssBytes,row.memoryStatus,1024**2],['code',row.codeBytes,row.codeStatus,1024]] as const){const key=`${row.workload}|${cid}|${metric}`;history.cells[key]||=dates.map(()=>({st:'nm',report:'',role:'retrospective-revision'}));history.cells[key][index]={st:status(measured),...(value!=null?{v:value/factor}:{}),...(metric===phase?{samples:row.samplesNs?.map(value=>value/1e6)}:{}),report,created:row.capturedAt,configuration:row.engine,role:'retrospective-revision'};}
   }
}
async function refreshHistory(targets:{platforms:string[];machine:MachineId}[]){
 if(historyBusy)return;historyBusy=true;historyAbort=new AbortController();const signal=historyAbort.signal;
 try{for(const {platforms,machine} of targets){
  const historical=(await Promise.all(platforms.flatMap(platform=>['steady','compile','instantiate','first-call'].map(phase=>rows(platform,phase,signal,true))))).flat().map(row=>row.engine.startsWith('wago-')?{...row,engine:'wago'}:row);
  signal.throwIfAborted();const historyView=emptyView();fillHistory(historyView,machine,historical);
  const previousEnd=Math.max(0,datasetView.current.history[machine].points.length-1);
  const followEnd=ui.histTo>=previousEnd;
  datasetView.current.history[machine]=historyView.history[machine];Object.assign(datasetView.current.reports,historyView.reports);datasetView.generation++;
  if(machine===ui.machine){const end=Math.max(0,historyView.history[machine].points.length-1);ui.histTo=followEnd?end:Math.min(ui.histTo,end);ui.histFrom=Math.min(ui.histFrom,ui.histTo);}
 }}catch(error){if(!signal.aborted)apiView.aggregateErrors.history=String(error)}finally{historyBusy=false;}
}
export async function connectSite(_origin='',_revision?:string){
 abort?.abort();abort=new AbortController();const signal=abort.signal;apiView.loading=true;apiView.error='';
 try{
  const platforms=await get<PlatformList>('/api/platforms',signal);const view=emptyView();const catalogue=new Map<string,Bench>();const historyTargets:{platforms:string[];machine:MachineId}[]=[];machines=[];
  for(const {machine,platforms:group} of platformGroups(platforms.items)){
   const platform=group[0];machines.push(machine);
   const host=view.hosts[machine];host.label=machineLabel(platform.cpu);host.os=`${platform.os}/${platform.arch} · ${platform.kernel}`;host.policy={cores:String(platform.cores),memory:platform.memoryBytes?`${(platform.memoryBytes/1024**3).toFixed(1)} GiB`:'not collected'};
   const normalize=(row:Result):Result=>row.engine.startsWith('wago-')?{...row,engine:'wago'}:row;
   const current=await Promise.all(group.flatMap(platform=>['compile','instantiate','first-call','steady'].map(phase=>rows(platform.id,phase,signal))));
   const all=selectEngineVersions(current.flat().map(normalize));
   historyTargets.push({platforms:group.map(p=>p.id),machine});
   for(const row of all){
    const cid=slot(row.engine);const cfg=CFG.find(c=>c.id===cid)!;CB[cid]=cfg;host.configurations[cid]={runtime:cfg.rt,version:row.engine.startsWith('wago-')?row.engine.slice(5)+' · '+row.version:row.version,backend:row.backend,source:row.source};view.configurations[cid]=row.engine;
    const report=row.capturedAt+'|'+row.engine;view.reports[report]={runId:report,created:row.capturedAt,evidence:'',sha256:'',options:{},codeRecords:[],configurations:[row.engine],host:machine};
    if(!catalogue.has(row.workload))catalogue.set(row.workload,{id:row.workload,artifactSha256:row.artifactSha256,tags:row.display?.tags||[],kb:row.display?.bytes?row.display.bytes/1024:null,ms:null,group:row.display?.group||(row.workload.startsWith('mechanisms/')?'Host calls':row.workload.split('/')[1]||'Other workloads'),purpose:row.display?.purpose||row.wasm,abi:row.display?.abi||'',src:row.display?.source,reset:row.display?.reset});
    const base={report,created:row.capturedAt,contract:row.contractSha256,configuration:row.engine};
    const phase=({compile:'compile',instantiate:'inst','first-call':'first',steady:'steady'} as const)[row.phase];
    host.snapshots.s1[`${row.workload}|${cid}|${phase}`]={...base,samples:row.samplesNs?.map(value=>value/1e6),st:status(row.latencyStatus),...(row.latencyNs!=null?{v:row.latencyNs/1e6}:{})};
    const memory=({compile:'rssCompile',instantiate:'rssInst','first-call':'rssFirst',steady:'rss'} as const)[row.phase];
    host.snapshots.s1[`${row.workload}|${cid}|${memory}`]={...base,st:status(row.memoryStatus),...(row.peakRssBytes!=null?{v:row.peakRssBytes/1024**2}:{})};
    host.snapshots.s1[`${row.workload}|${cid}|code`]={...base,st:status(row.codeStatus),...(row.codeBytes!=null?{v:row.codeBytes/1024}:{})};
   }
   view.history[machine]=datasetView.current.history[machine];

  }
  if(signal.aborted)return;
  view.catalogue=[...catalogue.values()];view.applicationConfigurations=[...new Set([...slots.values()])];view.statistics.machines=machines.length;
  if(!apiView.ready&&typeof location!=='undefined'){const shown=new URL(location.href).searchParams.get('rt');if(shown){const ids=shown.split(',');ui.hide=Object.fromEntries(CFG.map(c=>[c.id,!ids.includes(c.id)]));}}
  datasetView.current=view;datasetView.revision='';datasetView.generation++;apiView.ready=true;void refreshHistory(historyTargets);
  if(!machines.includes(ui.machine)&&machines.length)ui.machine=machines[0];datasetView.machine=ui.machine;
 }catch(error){if(!signal.aborted)apiView.error=String(error)}finally{if(!signal.aborted)apiView.loading=false}
}
export function firstMachine(){return machines[0]}
export function activatePageSeed(_seed:PageSeed){}
export async function loadPage(_scope:PageScope,_index=0,_append=false){}
export async function loadCalls(_scope:PageScope){}
export async function loadWorkload(_scope:PageScope){}
export async function loadFeatures(_scope:PageScope,_feature?:string,_configuration?:string){}
export async function loadHistory(_scope:PageScope,_metric:OtMetricKey,_workload='',_before?:string,_after?:string){}
export async function loadProposal(_scope:PageScope,_feature:string){}
export async function loadHistoryReport(_scope:PageScope,_metric:OtMetricKey,_cid:CfgId,_before:string,_after:string,_cursor=''){}
export async function loadOverview(_scope:PageScope,_metric:MetricKey|'rssAverage',_feature='',_signal?:AbortSignal){}
export function trackId(id:CfgId){return datasetView.current.configurations[id]}
export function resetPages(){apiView.cursors=[''];apiView.pageIndex=0}
export function currentClient():SiteDataset|null{return null}
export function closeSite(){abort?.abort();historyAbort?.abort();apiView.ready=false}
