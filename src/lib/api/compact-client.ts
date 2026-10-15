import {RequestPool} from './request-pool';

type Entry={value:unknown;bytes:number;etag:string};
/** A bounded cache and four-request queue for the mutable SQL API. */
export class CompactClient {
 private cache=new Map<string,Entry>();
 private bytes=0;
 private pool=new RequestPool();
 private active=0;
 private waiting:(()=>void)[]=[];
 private lifetime=new AbortController();
 private bootstrap:unknown;
 constructor(private request:typeof fetch=fetch){
  if(typeof document==='undefined')return;
  const node=document.getElementById('wasmfyi-bootstrap');if(!node)return;
  try{
   const text=node.textContent||'';
   if(text.length>65536)return;
   const value=JSON.parse(text);
   if(typeof value?.revision==='string'&&Array.isArray(value.platforms))this.bootstrap=value;
  }catch{}finally{node.remove()}
 }
 invalidate(predicate?:(path:string)=>boolean){if(!predicate){this.cache.clear();this.bytes=0;return}for(const [path,entry] of this.cache)if(predicate(path)){this.bytes-=entry.bytes;this.cache.delete(path)}}
 close(){this.lifetime.abort();this.invalidate()}
 private async reserve(signal:AbortSignal){
  signal.throwIfAborted();
  if(this.active<4){this.active++;return}
  await new Promise<void>((resolve,reject)=>{
   const wake=()=>{signal.removeEventListener('abort',cancel);resolve()};
   const cancel=()=>{const index=this.waiting.indexOf(wake);if(index>=0)this.waiting.splice(index,1);reject(signal.reason)};
   this.waiting.push(wake);signal.addEventListener('abort',cancel,{once:true});
   if(signal.aborted)cancel();
  });
 }
 private release(){const next=this.waiting.shift();if(next)next();else this.active--}
 async load<T>(path:string,signal:AbortSignal,revalidate=false):Promise<T>{
  if(!/^\/api\/(?:history\/(?:summary|comparison|report)|summary|table|matrix|timeline|overview|aggregates|observation|platforms|benchmarks|history)(?:\?|$)/.test(path))throw Error('Unsupported measurement endpoint');
  signal.throwIfAborted();
  if(path==='/api/summary'&&this.bootstrap){
   const value=this.bootstrap;this.bootstrap=undefined;
   const bytes=new TextEncoder().encode(JSON.stringify(value)).length;
   this.cache.set(path,{value,bytes,etag:''});this.bytes+=bytes;
   return value as T;
  }
  const cached=this.cache.get(path);
  if(cached&&!revalidate){this.cache.delete(path);this.cache.set(path,cached);return cached.value as T}
  return this.pool.load(path,async shared=>{
   const combined=AbortSignal.any([shared,this.lifetime.signal,AbortSignal.timeout(30000)]);
   await this.reserve(combined);
   try{
    const response=await this.request(path,{signal:combined,headers:cached?.etag?{'If-None-Match':cached.etag}:{}});
    if(response.status===304&&cached)return cached.value as T;
    if(!response.ok){const body=await response.json().catch(()=>null);throw Object.assign(Error(body?.error?.message||'Could not load measurements'),{status:response.status})}
    if(!response.body)throw Error('Empty measurement response');
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
    try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>4*1024*1024){await reader.cancel();throw Error('Measurement response exceeds scope limit')};chunks.push(item.value)}}finally{reader.releaseLock()}
    const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
    combined.throwIfAborted();
    const previous=this.cache.get(path);if(previous)this.bytes-=previous.bytes;
    this.cache.delete(path);this.cache.set(path,{value,bytes,etag:response.headers.get('ETag')||''});this.bytes+=bytes;
    while(this.cache.size>64||this.bytes>8*1024*1024){const oldest=this.cache.keys().next().value!;this.bytes-=this.cache.get(oldest)!.bytes;this.cache.delete(oldest)}
    return value as T;
   }finally{this.release()}
  },signal);
 }
}
