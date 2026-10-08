import {RequestPool} from './request-pool';
import type { DatasetManifest, RecordPage, WireRecord } from './types';
const MAX_RESPONSE = 1024 * 1024;
const HASH=/^[a-f0-9]{64}$/;
const CATALOGS='results|reports|metrics|tracks|configurations|environments|workloads|artifacts|features|conformance|conformance-contexts|conformance-coverage|methods|files|availability|feature-summary';
const RESOURCE=new RegExp(`^(?:${CATALOGS})(?:/[a-f0-9]{64}(?:/(?:samples|evidence|files|functions|disassembly))?)?$`);
function resourceAllowed(resource:string) {
 if(resource==='corpus'||resource==='inspect'||/^(?:corpus|inspect)\/[a-f0-9]{64}$/.test(resource))return true;
 return RESOURCE.test(resource)||resource==='matrix'||resource==='history'||resource==='history/timeline'||resource==='history/series'||resource==='history/changes'||resource==='history/coverage'||/^history\/(?:jobs|coverage)\/[a-f0-9]{64}$/.test(resource)||resource==='overview'||resource==='aggregates'||/^cohorts\/[A-Za-z0-9_.-]{1,16384}$/.test(resource)||/^conformance\/sources\/[a-f0-9]{64}(?:\/chunks)?$/.test(resource);
}
async function requestWithRetry(request:typeof fetch,url:string,signal:AbortSignal):Promise<Response> {
 for(;;) {
  signal.throwIfAborted();
  const response=await request(url,{signal});
  if(response.status!==429)return response;
  const retry=response.headers.get('Retry-After');await response.body?.cancel();
  if(!retry||!/^\d+$/.test(retry)||Number(retry)<1||Number(retry)>30)throw new ApiError('Invalid API retry delay',429);
  await new Promise<void>((resolve,reject)=>{
   const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(signal.reason)};
   const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve()},Number(retry)*1000);
   signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  });
 }
}
export class ApiError extends Error {
 constructor(message:string, readonly status?:number) { super(message); }
}
async function bounded(response:Response, maximum:number):Promise<{value:unknown;bytes:number}> {
 if(!response.ok)throw new ApiError(`API request failed (${response.status})`,response.status);
 if(!response.body)throw new ApiError('API returned an empty body');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximum){await reader.cancel();throw new ApiError('API response exceeds decoded-byte limit')};chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 try{return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),bytes:size}}catch{throw new ApiError('API returned invalid JSON')}
}
/** One client is one frozen revision. Construct a new client to refresh. */
export class DatasetClient {
 private readonly abort = new AbortController();
 private readonly cache = new Map<string,{value:unknown;bytes:number}>();
 private bytes=0;
 private pool=new RequestPool();
 private constructor(readonly origin:string,readonly revision:string,readonly manifest:DatasetManifest,private readonly request:typeof fetch) {}
 static fromManifest(manifest:DatasetManifest,origin='',request:typeof fetch=fetch):DatasetClient {
  if(manifest.schema!==2||!HASH.test(manifest.revision))throw new ApiError('Invalid embedded dataset manifest');
  return new DatasetClient(origin.replace(/\/$/,''),manifest.revision,manifest,request);
 }
 static async connect(origin='',request:typeof fetch=fetch,signal?:AbortSignal,revision?:string):Promise<DatasetClient> {
  const root=origin.replace(/\/$/,'');const combined=AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])]);
  const {value}=await bounded(await requestWithRetry(request,`${root}/api/v1/manifest`,combined),20*1024);
  const manifest=value as DatasetManifest;
  if(manifest.schema!==2)throw new ApiError('No supported published dataset');
  if(revision) {
   if(!HASH.test(revision))throw new ApiError('Invalid dataset revision');
   const {value:record}=await bounded(await requestWithRetry(request,`${root}/api/v1/revisions/${revision}`,combined),MAX_RESPONSE);
   if((record as {id?:string}).id!==revision)throw new ApiError('Response revision differs from requested dataset');
   manifest.revision=revision;
  }
  if(!manifest.revision?.match(HASH))throw new ApiError('No supported published dataset');
  return new DatasetClient(root,manifest.revision,manifest,request);
 }
 close(){this.abort.abort();this.cache.clear();this.bytes=0}
 async load<T>(resource:string,parameters:Record<string,string|number>={},signal?:AbortSignal):Promise<T> {
  signal?.throwIfAborted();
  if(this.abort.signal.aborted)throw new ApiError('Dataset client is closed');
  if(!resourceAllowed(resource))throw new ApiError('Unsupported API resource');
  if(parameters.revision!==undefined&&parameters.revision!==this.revision)throw new ApiError('Query revision differs from client');
  const scoped=['overview','aggregates','history/series','history/changes'].includes(resource);
  const capsule=resource.startsWith('cohorts/');
  const values={...parameters};
  if(scoped) {
   delete values.revision;
   const keys=resource==='history/changes'?['before','after']:['scope'];
   for(const key of keys) {
    let scope:Record<string,unknown>;try{scope=JSON.parse(String(values[key]))}catch{throw new ApiError('Invalid query scope')}
    if(!scope||typeof scope!=='object'||Array.isArray(scope)||scope.revision!==undefined&&scope.revision!==this.revision)throw new ApiError('Query revision differs from client');
    values[key]=JSON.stringify({...scope,revision:this.revision});
   }
  } else if(!capsule)values.revision=this.revision;
  const query=new URLSearchParams(Object.entries(values).map(([k,v])=>[k,String(v)]));query.sort();
  const key=`${resource}?${query}`;const cached=this.cache.get(key);
  if(cached){this.cache.delete(key);this.cache.set(key,cached);return cached.value as T}
  return this.pool.load<T>(key,async sharedSignal=>{
  const combined=AbortSignal.any([this.abort.signal,AbortSignal.timeout(30000),sharedSignal]);
  const {value,bytes}=await bounded(await requestWithRetry(this.request,`${this.origin}/api/v1/${key}`,combined),MAX_RESPONSE);
  combined.throwIfAborted();
  // Sample chunks are producer arrays or trial envelopes, with no revision
  // field; the URL and result membership checks bind them to this revision.
  const envelope=value as {revision?:string;scope?:{revision?:string};beforeScope?:{revision?:string};afterScope?:{revision?:string}};
  if(!resource.endsWith('/samples')&&!resource.endsWith('/evidence')&&!resource.endsWith('/chunks')&&(envelope.revision??envelope.scope?.revision??(envelope.beforeScope?.revision===envelope.afterScope?.revision?envelope.beforeScope?.revision:undefined))!==this.revision)throw new ApiError('Response revision differs from active dataset');
  this.cache.set(key,{value,bytes});this.bytes+=bytes;
  while(this.cache.size>32||this.bytes>4*MAX_RESPONSE){const oldest=this.cache.keys().next().value!;this.bytes-=this.cache.get(oldest)!.bytes;this.cache.delete(oldest)}
  return value as T;
  },signal);
 }
 results(parameters:Record<string,string|number>,signal?:AbortSignal){return this.load<RecordPage>('results',parameters,signal)}
 report(id:string,signal?:AbortSignal){return this.load<{revision:string;record:WireRecord}>(`reports/${id}`,{},signal)}
}
