import {DatasetClient,ApiError} from './client';
import {detailSelectors,presentResult} from './presentation';
import type {CohortScope,CohortSelector,RecordPage,WireRecord,Overview} from './types';
import type {MetricKey} from '../data/types';

export type ResultScope={environment:string;environments?:string[];selection:'current'|'previous';metric:MetricKey|'rssFirst';workload?:string;track?:string;sort?:'catalog'|'value'|'-value'};
export type ResultWindow={items:ReturnType<typeof presentResult>[];nextCursor:string;complete:boolean;total:number;revision:string};
export type MatrixPage={revision:string;items:{workload:WireRecord;results:WireRecord[];group:string;eligibility:Record<string,{status:string;reason:string}>}[];nextCursor:string;complete:boolean;total:number;selectionPolicy:string;groups:{name:string;total:number;cells:{track:string;value:number|null;count:number}[]}[]};
export type AvailableMetric={metric:string;scenario:string;profile:string;statistic:string;selectors:CohortSelector[];results:number};
export type Availability={revision:string;items:{track:string;configurations:WireRecord[];metrics:AvailableMetric[];coverage:[number,number,number,number,number]}[];workloads:number};
/** A browser view owns one immutable revision. Every method reads bounded scope. */
export class SiteDataset {
 private overviewQueue:Promise<unknown>=Promise.resolve();
 private constructor(readonly client:DatasetClient){}
 static fromRevision(revision:string,origin='',request:typeof fetch=fetch){return new SiteDataset(DatasetClient.fromManifest({schema:2,revision,selectionAliases:{s1:'current',s2:'previous'},limits:{},endpoints:[]},origin,request))}
 static async connect(origin='',request:typeof fetch=fetch,signal?:AbortSignal,revision?:string){return new SiteDataset(await DatasetClient.connect(origin,request,signal,revision))}
 get revision(){return this.client.revision}
 close(){this.client.close()}
 catalog(kind:'environments'|'tracks'|'workloads'|'metrics'|'configurations',cursor='',signal?:AbortSignal){
  return this.client.load<RecordPage>(kind,{limit:50,...(cursor?{cursor}:{}),...(kind==='configurations'?{projection:'configuration-display-v1'}:{})},signal);
 }
 availability(environment:string,environments:string[],selection:'current'|'previous',signal?:AbortSignal,selector?:{metric:string;scenario?:string;statistic:string}){return this.client.load<Availability>('availability',{version:'availability-v3',environment,...(environments.length?{environments:JSON.stringify(environments)}:{}),selection,...(selector?{metric:selector.metric,...(selector.scenario?{scenario:selector.scenario}:{}),statistic:selector.statistic}:{}),...(selector?.metric==='time.wall'?{profile:'timing'}:{})},signal)}
 async results(scope:ResultScope,cursor='',signal?:AbortSignal):Promise<ResultWindow>{
  const selector=detailSelectors[scope.metric];
  const page=await this.client.results({environment:scope.environment,...(scope.environments?{environments:JSON.stringify(scope.environments)}:{}),selection:scope.selection,metric:selector.metric,
   scenario:selector.scenario,statistic:selector.statistic,...(selector.metric==='time.wall'?{profile:'timing'}:{}),
   ...(scope.workload?{workload:scope.workload}:{}),...(scope.track?{track:scope.track}:{}),sort:scope.sort||'catalog',limit:100,...(cursor?{cursor}:{})},signal);
  return {...page,items:page.items.map(presentResult)};
 }
 matrix(scope:ResultScope&{tracks:string[];cohortMode?:'shared'|'per-engine';search?:string;tag?:string;sortTrack?:string;direction?:'asc'|'desc'},cursor='',signal?:AbortSignal){
  const selector=detailSelectors[scope.metric];return this.client.load<MatrixPage>('matrix',{version:'matrix-v3',
   environment:scope.environment,...(scope.environments?{environments:JSON.stringify(scope.environments)}:{}),selection:scope.selection,
   metric:selector.metric,scenario:selector.scenario,statistic:selector.statistic,...(selector.metric==='time.wall'?{profile:'timing'}:{}),
   tracks:JSON.stringify(scope.tracks),...(scope.cohortMode?{cohortMode:scope.cohortMode}:{}),limit:25,...(scope.workload?{workload:scope.workload}:{}),...(scope.search?{search:scope.search}:{}),...(scope.tag?{tag:scope.tag}:{}),
   ...(scope.sortTrack?{sortTrack:scope.sortTrack,direction:scope.direction||'asc'}:{}),...(cursor?{cursor}:{})},signal);
 }
 overview(scope:CohortScope,signal?:AbortSignal){const pending=this.overviewQueue.then(()=>{signal?.throwIfAborted();return this.client.load<Overview>('overview',{scope:JSON.stringify(scope),version:'wasmfyi-cohort-v4'},signal)});this.overviewQueue=pending.catch(()=>{});return pending}
 descriptor(kind:'results'|'reports'|'workloads'|'configurations'|'artifacts'|'environments'|'methods',id:string,signal?:AbortSignal){return this.client.load<{revision:string;record:WireRecord}>(`${kind}/${id}`,{},signal)}
 evidence(kind:'results'|'reports',id:string,chunk:string,signal?:AbortSignal){return this.client.load<unknown>(`${kind}/${id}/${kind==='results'?'samples':'evidence'}`,{chunk},signal)}
 membership(cohort:string,lane:string,cursor='',signal?:AbortSignal){return this.client.load(`cohorts/${cohort}`,{lane,limit:100,...(cursor?{cursor}:{})},signal)}
 files(report:string,signal?:AbortSignal){return this.client.load<RecordPage>(`reports/${report}/files`,{},signal)}
 functions(artifact:string,cursor='',signal?:AbortSignal){return this.client.load<RecordPage>(`artifacts/${artifact}/functions`,{limit:100,...(cursor?{cursor}:{})},signal)}
 disassembly(artifact:string,ordinal:number,cursor='',signal?:AbortSignal){return this.client.load(`artifacts/${artifact}/disassembly`,{function:ordinal,limit:100,...(cursor?{cursor}:{})},signal)}
 url(resource:string,parameters:Record<string,string|number>={}){
  if(!/^(?:files\/[a-f0-9]{64}\/download|artifacts\/[a-f0-9]{64}\/(?:bytes|content))$/.test(resource))throw new ApiError('Unsupported download resource');
  const query=new URLSearchParams(Object.entries({...parameters,revision:this.revision}).map(([k,v])=>[k,String(v)]));
  return `${this.client.origin}/api/v1/${resource}?${query}`;
 }
}
