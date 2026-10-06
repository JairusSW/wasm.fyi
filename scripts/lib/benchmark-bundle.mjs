import {open,lstat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {digest} from "./wasmbench.mjs";
const HASH=/^[a-f0-9]{64}$/;
const SMALL=256*1024;
const PART=32*1024*1024;
const MAX_PARTS=2048;
async function regular(directory,name,maximum,signal){
 signal?.throwIfAborted();
 const root=await lstat(directory);
 if(!root.isDirectory()||root.isSymbolicLink())throw Error("Unsafe parent bundle directory");
 const path=join(directory,name),before=await lstat(path);
 if(!before.isFile()||before.isSymbolicLink()||before.size>maximum)throw Error("Unsafe or oversized parent bundle file");
 const file=await open(path,"r");
 try{signal?.throwIfAborted();const after=await file.stat();if(!after.isFile()||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size)throw Error("Parent bundle file changed while opening");return {file,size:after.size};}catch(error){await file.close();throw error}
}
async function small(directory,name,signal){
 const {file,size}=await regular(directory,name,SMALL,signal);
 try{const bytes=Buffer.alloc(size+1);let total=0;while(total<bytes.length){signal?.throwIfAborted();const {bytesRead}=await file.read(bytes,total,bytes.length-total,total);if(bytesRead===0)break;total+=bytesRead;}signal?.throwIfAborted();if(total!==size)throw Error("Parent metadata changed while reading");return bytes.subarray(0,size);}finally{await file.close()}
}
export async function readParentBundleMetadata(directory,plan,{signal}={}){
 signal?.throwIfAborted();
 const indexBytes=await small(directory,"index.json",signal),index=JSON.parse(indexBytes);
 if(index.schema!==1||typeof index.id!=="string"||!index.id||typeof index.machine!=="string"||!index.machine||index.metadata!=="metadata.json"||!HASH.test(index.sha256)||!Number.isSafeInteger(index.bytes)||index.bytes<1||!Array.isArray(index.parts)||index.parts.length<1||index.parts.length>MAX_PARTS)throw Error("Invalid parent bundle index");
 let total=0;
 for(const [i,part]of index.parts.entries()){
  signal?.throwIfAborted();
  if(!part||part.path!==`bundle.tar.gz.part-${String(i).padStart(3,"0")}`||!HASH.test(part.sha256)||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>PART)throw Error("Unsafe parent archive part");
  total+=part.bytes;
 }
 if(total!==index.bytes)throw Error("Parent archive index size mismatch");
 const metadataBytes=await small(directory,"metadata.json",signal),metadata=JSON.parse(metadataBytes);
 if(index.metadataSha256!==undefined&&(!HASH.test(index.metadataSha256)||digest(metadataBytes)!==index.metadataSha256))throw Error("Parent metadata digest mismatch");
 if(!metadata||typeof metadata.planSha256!=="string"||!metadata.planSha256)throw Error("Invalid parent metadata plan");
 if(plan&&(index.id!==plan.id||metadata.planSha256!==plan.identity||(plan.machine!==undefined&&index.machine!==plan.machine)))throw Error("Parent collection bundle belongs to another plan or machine");
 return {index,indexBytes,metadata,metadataBytes};
}
export async function verifyParentBundle(directory,plan,{signal}={}){
 signal?.throwIfAborted();
 const {index}=await readParentBundleMetadata(directory,plan,{signal});
 const full=createHash("sha256");let bytes=0;
 for(const part of index.parts){
  signal?.throwIfAborted();
  const {file,size}=await regular(directory,part.path,PART,signal);
  try{
   if(size!==part.bytes)throw Error("Parent archive part digest mismatch");
   const hash=createHash("sha256");let read=0;
   for await(const b of file.createReadStream({highWaterMark:1024*1024,autoClose:false,signal})){
    signal?.throwIfAborted();read+=b.length;if(read>part.bytes)throw Error("Parent archive part grew during verification");hash.update(b);full.update(b);
   }
   signal?.throwIfAborted();if(read!==part.bytes||hash.digest("hex")!==part.sha256)throw Error("Parent archive part digest mismatch");
   bytes+=read;
  }finally{await file.close()}
 }
 signal?.throwIfAborted();
 if(bytes!==index.bytes||full.digest("hex")!==index.sha256)throw Error("Parent archive digest mismatch");
 return index;
}
