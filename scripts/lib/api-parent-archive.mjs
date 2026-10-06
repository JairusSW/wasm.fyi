import assert from 'node:assert/strict';
import {mkdir,writeFile,rename,lstat,rm,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {digest,site} from './wasmbench.mjs';
const HASH=/^[a-f0-9]{64}$/,CHUNK=1024*1024,MAX=1024*1024*1024;
// Receipts attest only local cache bytes, never scientific source verification.
// Every reuse still stats each file; inode, size, mode and nanosecond change times
// invalidate a receipt. Retention is bounded by both count and accounted bytes.
const receipts=new Map(),RECEIPTS=8,RECEIPT_BYTES=2*1024*1024;let receiptBytes=0;
const stamp=info=>[info.dev,info.ino,info.size,info.mode,info.mtimeNs,info.ctimeNs].join(':');
function forget(folder){const old=receipts.get(folder);if(old){receiptBytes-=old.cost;receipts.delete(folder)}}
function remember(folder,identity,stamps){
 const cost=512+2*(folder.length+identity.length)+stamps.reduce((sum,value)=>sum+128+2*value.length,0);
 forget(folder);if(cost>RECEIPT_BYTES)return;
 while(receipts.size>=RECEIPTS||receiptBytes+cost>RECEIPT_BYTES)forget(receipts.keys().next().value);
 receipts.set(folder,{identity,stamps,cost});receiptBytes+=cost;
}
async function cacheIntact(folder,parent,signal){
 const objects=[parent.index,parent.metadata,...parent.chunks],identity=digest(Buffer.from(JSON.stringify(parent))),stamps=[];
 try{
  for(const object of objects){
   signal?.throwIfAborted();const info=await lstat(join(folder,object.sha256),{bigint:true});
   if(!info.isFile()||info.isSymbolicLink()||info.size!==BigInt(object.bytes)){forget(folder);return false}
   stamps.push(stamp(info));
  }
  const receipt=receipts.get(folder);
  if(receipt?.identity===identity&&receipt.stamps.length===stamps.length&&receipt.stamps.every((value,i)=>value===stamps[i]))return true;
  forget(folder);const full=createHash('sha256');let total=0;
  for(const [i,object]of objects.entries()){
   signal?.throwIfAborted();const file=await open(join(folder,object.sha256),'r');
   try{
    if(stamp(await file.stat({bigint:true}))!==stamps[i])return false;
    // One bounded cache object plus a sentinel byte, even if the file grows.
    const bytes=Buffer.alloc(object.bytes+1);let read=0;
    while(read<bytes.length){signal?.throwIfAborted();const result=await file.read(bytes,read,bytes.length-read,read);if(!result.bytesRead)break;read+=result.bytesRead}
    signal?.throwIfAborted();
    if(read!==object.bytes||stamp(await file.stat({bigint:true}))!==stamps[i]||digest(bytes.subarray(0,read))!==object.sha256)return false;
    if(i>=2){full.update(bytes.subarray(0,read));total+=read}
   }finally{await file.close()}
  }
  if(total!==parent.bytes||full.digest('hex')!==parent.sha256)return false;
  remember(folder,identity,stamps);return true;
 }catch(error){forget(folder);signal?.throwIfAborted();if(error.name==='AbortError')throw error;return false}
}
async function readDescriptor(path,signal){
 signal?.throwIfAborted();const before=await lstat(path,{bigint:true});
 assert(before.isFile()&&!before.isSymbolicLink()&&before.size<=256n*1024n,'Invalid parent cache descriptor');
 const file=await open(path,'r');
 try{
  assert(stamp(await file.stat({bigint:true}))===stamp(before),'Parent cache descriptor changed while opening');
  const bytes=Buffer.alloc(Number(before.size)+1);let read=0;
  while(read<bytes.length){signal?.throwIfAborted();const result=await file.read(bytes,read,bytes.length-read,read);if(!result.bytesRead)break;read+=result.bytesRead}
  signal?.throwIfAborted();assert(read===Number(before.size)&&stamp(await file.stat({bigint:true}))===stamp(before),'Parent cache descriptor changed while reading');
  return JSON.parse(bytes.subarray(0,read));
 }finally{await file.close()}
}
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export async function prepareParentArchive(directory,source,{cache=join(site,'.cache/collection-api-parent'),signal}={}){
 signal?.throwIfAborted();
 const {index,indexBytes,metadataBytes}=source,indexHash=digest(indexBytes);
 assert(index.bytes<=MAX&&HASH.test(index.metadataSha256)&&digest(metadataBytes)===index.metadataSha256,'Parent archive exceeds transport contract or lacks metadata integrity');
 const folder=join(cache,indexHash);await mkdir(folder,{recursive:true,mode:0o700});assert(!(await lstat(folder)).isSymbolicLink(),'Symlinked parent transport cache');
 const descriptorPath=join(folder,'transport.json');let parent;
 try{parent=await readDescriptor(descriptorPath,signal);}catch{signal?.throwIfAborted();parent=null}
 let valid=exactKeys(parent,['schema','index','metadata','sha256','bytes','chunks'])&&exactKeys(parent.index,['sha256','bytes','kind'])&&exactKeys(parent.metadata,['sha256','bytes','kind'])&&parent.schema===1&&parent.index?.sha256===indexHash&&parent.index.kind==='evidence'&&parent.index.bytes===indexBytes.length&&parent.metadata?.sha256===index.metadataSha256&&parent.metadata.kind==='evidence'&&parent.metadata.bytes===metadataBytes.length&&parent.sha256===index.sha256&&parent.bytes===index.bytes&&Array.isArray(parent.chunks)&&parent.chunks.length>0&&parent.chunks.length<=2048&&parent.chunks.every(o=>exactKeys(o,['sha256','bytes','kind'])&&HASH.test(o.sha256)&&o.kind==='binary'&&Number.isSafeInteger(o.bytes)&&o.bytes>0&&o.bytes<=CHUNK)&&parent.chunks.reduce((sum,o)=>sum+o.bytes,0)===index.bytes;
 if(valid){
  // Internal cache key ordering must not change the completed-job identity.
  const object=value=>({sha256:value.sha256,bytes:value.bytes,kind:value.kind});
  parent={schema:1,index:object(parent.index),metadata:object(parent.metadata),sha256:parent.sha256,bytes:parent.bytes,chunks:parent.chunks.map(object)};
  valid=await cacheIntact(folder,parent,signal);
 }
 const install=async(bytes,kind)=>{
  signal?.throwIfAborted();const sha256=digest(bytes),path=join(folder,sha256),temp=join(folder,sha256+'.'+randomUUID()+'.tmp');
  try{await writeFile(temp,bytes,{mode:0o600,signal});signal?.throwIfAborted();await rename(temp,path);return {sha256,bytes:bytes.length,kind};}
  finally{await rm(temp,{force:true});}
 };
 if(!valid){
  const chunks=[],whole=createHash('sha256');let bytes=0;
  for(const part of index.parts){
   signal?.throwIfAborted();
   const path=join(directory,part.path),info=await lstat(path);assert(info.isFile()&&!info.isSymbolicLink()&&info.size===part.bytes,'Parent part differs from source index');
   const hash=createHash('sha256');let size=0;
   for await(const b of createReadStream(path,{highWaterMark:CHUNK,signal})){signal?.throwIfAborted();size+=b.length;bytes+=b.length;assert(size<=part.bytes&&bytes<=MAX,'Parent archive grew during transport');hash.update(b);whole.update(b);chunks.push(await install(b,'binary'));assert(chunks.length<=2048,'Too many parent transport chunks')}
   assert(size===part.bytes&&hash.digest('hex')===part.sha256,'Parent archive part digest mismatch');
  }
  signal?.throwIfAborted();assert(bytes===index.bytes&&whole.digest('hex')===index.sha256,'Parent archive full digest mismatch');
  parent={schema:1,index:await install(indexBytes,'evidence'),metadata:await install(metadataBytes,'evidence'),sha256:index.sha256,bytes:index.bytes,chunks};
  const temp=descriptorPath+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,JSON.stringify(parent),{mode:0o600,signal});signal?.throwIfAborted();await rename(temp,descriptorPath);}
  finally{await rm(temp,{force:true});}
  assert(await cacheIntact(folder,parent,signal),'Parent cache differs after materialization');
 }
 signal?.throwIfAborted();
 assert(parent.index.kind==='evidence'&&parent.index.bytes===indexBytes.length&&parent.metadata.kind==='evidence'&&parent.metadata.bytes===metadataBytes.length,'Parent cached descriptor differs');
 return {parent,objects:[parent.index,parent.metadata,...parent.chunks].map(o=>({...o,path:join(folder,o.sha256)}))};
}
