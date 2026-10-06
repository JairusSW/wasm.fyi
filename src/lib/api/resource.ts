import type { JSONResource, JSONFragment } from './types';
const MAX_BYTES=64*1024*1024;
const MAX_PART=120*1024;
const HASH=/^[a-f0-9]{64}$/;
/** Explicit evidence assembly; ordinary result/catalog reads never call this. */
export async function assembleJSONResource(resource:JSONResource,read:(digest:string)=>Promise<JSONFragment>,signal?:AbortSignal):Promise<unknown>{
 if(resource.kind!=='json-resource'||resource.schema!==1||resource.encoding!=='json-utf8'||!Number.isSafeInteger(resource.bytes)||resource.bytes<1||resource.bytes>MAX_BYTES||!HASH.test(resource.sha256)||!Array.isArray(resource.references)||resource.references.length<1||resource.references.length>1024||resource.references.some(h=>!HASH.test(h)))throw Error('Invalid JSON resource');
 signal?.throwIfAborted();
 const value=new Uint8Array(resource.bytes),encoder=new TextEncoder();let offset=0;
 for(const hash of resource.references){
  signal?.throwIfAborted();const part=await read(hash);signal?.throwIfAborted();
  if(part.kind!=='json-fragment'||part.schema!==1||typeof part.text!=='string'||!part.text.length)throw Error('Invalid JSON fragment');
  const bytes=encoder.encode(part.text);
  if(bytes.length>MAX_PART||bytes.length>value.length-offset)throw Error('JSON resource exceeds declared bytes');
  value.set(bytes,offset);offset+=bytes.length;
 }
 if(offset!==value.length)throw Error('JSON resource byte count differs');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');
 signal?.throwIfAborted();if(digest!==resource.sha256)throw Error('JSON resource hash differs');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value));
}
