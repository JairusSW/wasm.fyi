import type { DatasetManifest, RecordPage, WireRecord } from './types';
const MAX_RESPONSE = 1024 * 1024;
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
 private constructor(readonly origin:string,readonly revision:string,readonly manifest:DatasetManifest,private readonly request:typeof fetch) {}
 static async connect(origin='',request:typeof fetch=fetch,signal?:AbortSignal):Promise<DatasetClient> {
  const root=origin.replace(/\/$/,'');const {value}=await bounded(await request(`${root}/api/v1/manifest`,{signal}),20*1024);
  const manifest=value as DatasetManifest;
  if(manifest.schema!==2||!manifest.revision?.match(/^[a-f0-9]{64}$/))throw new ApiError('No supported published dataset');
  return new DatasetClient(root,manifest.revision,manifest,request);
 }
 close(){this.abort.abort();this.cache.clear();this.bytes=0}
 async load<T>(resource:string,parameters:Record<string,string|number>={},signal?:AbortSignal):Promise<T> {
  signal?.throwIfAborted();
  if(this.abort.signal.aborted)throw new ApiError('Dataset client is closed');
  if(!/^(results|reports|metrics|tracks|configurations|environments|workloads|artifacts|history)(\/([a-f0-9]{64})(\/samples)?)?$/.test(resource))throw new ApiError('Unsupported API resource');
  if(parameters.revision!==undefined&&parameters.revision!==this.revision)throw new ApiError('Query revision differs from client');
  const query=new URLSearchParams(Object.entries({...parameters,revision:this.revision}).map(([k,v])=>[k,String(v)]));query.sort();
  const key=`${resource}?${query}`;const cached=this.cache.get(key);
  if(cached){this.cache.delete(key);this.cache.set(key,cached);return cached.value as T}
  const combined=AbortSignal.any([this.abort.signal,...(signal?[signal]:[])]);
  const {value,bytes}=await bounded(await this.request(`${this.origin}/api/v1/${key}`,{signal:combined}),MAX_RESPONSE);
  combined.throwIfAborted();
  // Sample chunks are producer arrays or trial envelopes, with no revision
  // field; the URL and result membership checks bind them to this revision.
  if(!resource.endsWith('/samples')&&(value as {revision?:string}).revision!==this.revision)throw new ApiError('Response revision differs from active dataset');
  this.cache.set(key,{value,bytes});this.bytes+=bytes;
  while(this.cache.size>32||this.bytes>4*MAX_RESPONSE){const oldest=this.cache.keys().next().value!;this.bytes-=this.cache.get(oldest)!.bytes;this.cache.delete(oldest)}
  return value as T;
 }
 results(parameters:Record<string,string|number>,signal?:AbortSignal){return this.load<RecordPage>('results',parameters,signal)}
 report(id:string,signal?:AbortSignal){return this.load<{revision:string;record:WireRecord}>(`reports/${id}`,{},signal)}
}
