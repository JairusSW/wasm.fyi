import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,rename,lstat,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {digest,site} from './wasmbench.mjs';
const HASH=/^[a-f0-9]{64}$/,CHUNK=1024*1024,MAX=1024*1024*1024;
export async function prepareParentArchive(directory,source,{cache=join(site,'.cache/collection-api-parent'),signal}={}){
 signal?.throwIfAborted();
 const {index,indexBytes,metadataBytes}=source,indexHash=digest(indexBytes);
 assert(index.bytes<=MAX&&HASH.test(index.metadataSha256)&&digest(metadataBytes)===index.metadataSha256,'Parent archive exceeds transport contract or lacks metadata integrity');
 const folder=join(cache,indexHash);await mkdir(folder,{recursive:true,mode:0o700});assert(!(await lstat(folder)).isSymbolicLink(),'Symlinked parent transport cache');
 const descriptorPath=join(folder,'transport.json');let parent;
 try{const info=await lstat(descriptorPath);assert(info.isFile()&&!info.isSymbolicLink()&&info.size<=256*1024);parent=JSON.parse(await readFile(descriptorPath,{signal}));}catch{signal?.throwIfAborted();parent=null}
 const valid=parent&&parent.schema===1&&parent.index?.sha256===indexHash&&parent.index.kind==='evidence'&&parent.index.bytes===indexBytes.length&&parent.metadata?.sha256===index.metadataSha256&&parent.metadata.kind==='evidence'&&parent.metadata.bytes===metadataBytes.length&&parent.sha256===index.sha256&&parent.bytes===index.bytes&&Array.isArray(parent.chunks)&&parent.chunks.length>0&&parent.chunks.length<=2048&&parent.chunks.every(o=>o&&HASH.test(o.sha256)&&o.kind==='binary'&&Number.isSafeInteger(o.bytes)&&o.bytes>0&&o.bytes<=CHUNK)&&parent.chunks.reduce((sum,o)=>sum+o.bytes,0)===index.bytes;
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
 }
 signal?.throwIfAborted();
 assert(parent.index.kind==='evidence'&&parent.index.bytes===indexBytes.length&&parent.metadata.kind==='evidence'&&parent.metadata.bytes===metadataBytes.length,'Parent cached descriptor differs');
 return {parent,objects:[parent.index,parent.metadata,...parent.chunks].map(o=>({...o,path:join(folder,o.sha256)}))};
}
