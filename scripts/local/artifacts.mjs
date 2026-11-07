import {readFile,writeFile,mkdir,open,rename,rm} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parseCorpusJSON} from '../lib/corpus.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function artifactOrigin(value='https://wasm.fyi'){
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Artifact origin must be HTTPS (or loopback HTTP)');
 return url.origin;
}
async function artifactRequest(url,fetchImpl,timeout){
 const parsed=new URL(url),headers=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)?{'X-Real-IP':'127.0.0.1'}:{};
 for(let attempt=0;;attempt++){
  const response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(timeout),redirect:'error'});
  if(![429,503].includes(response.status)||attempt>=2)return response;
  const retry=Number(response.headers.get('retry-after'));await response.body?.cancel();
  await new Promise(resolve=>setTimeout(resolve,retry>0?Math.min(retry,2)*1000:500));
 }
}
export async function fetchArtifact(workload,{cache,origin='https://wasm.fyi',offline=false,fetchImpl=fetch}){
 if(!/^[a-f0-9]{64}$/.test(workload.sha256))throw Error('Invalid artifact SHA-256: '+workload.id);
 const target=join(cache,'artifacts',workload.sha256+'.wasm');
 for(const candidate of [target,workload.artifact].filter(Boolean)){
  try{const bytes=await readFile(candidate);if(sha(bytes)===workload.sha256){if(candidate!==target){await mkdir(dirname(target),{recursive:true});const t=target+'.'+randomUUID();try{await writeFile(t,bytes,{flag:'wx',mode:0o600});await rename(t,target)}finally{await rm(t,{force:true})}}return {...workload,artifact:target,artifactName:workload.artifactName||basename(workload.artifact||target)}}}catch(error){if(error.code!=='ENOENT')throw error}
 }
 if(offline)return null;
 const url=artifactOrigin(origin)+'/api/artifacts/'+workload.sha256+'.wasm';
 const response=await artifactRequest(url,fetchImpl,30000);
 if(response.status===404||response.status===410)return null;
 if(!response.ok)throw Error('Artifact download HTTP '+response.status);
 if(Number(response.headers.get('content-length'))>256*1024*1024)throw Error('Artifact exceeds download size limit');
 await mkdir(dirname(target),{recursive:true});const temporary=target+'.'+randomUUID(),file=await open(temporary,'wx',0o600),hash=createHash('sha256');let size=0;
 try{
  if(!response.body)throw Error('Artifact download has no body');
  for await(const chunk of response.body){size+=chunk.length;if(size>256*1024*1024)throw Error('Artifact exceeds download size limit');hash.update(chunk);await file.writeFile(chunk)}
  if(hash.digest('hex')!==workload.sha256)throw Error('Downloaded artifact SHA-256 mismatch: '+workload.id);
  await file.close();await rename(temporary,target);return {...workload,artifact:target,artifactName:workload.artifactName||basename(workload.artifact||target)};
 }finally{await file.close().catch(()=>{});await rm(temporary,{force:true})}
}
export async function ensureArtifacts(workloads,options){
 const results=new Array(workloads.length),pending=new Map();let next=0;
 // Four streams bound server load and avoid one network round trip per contract
 // when many contracts share the same Wasm file. Builds remain serialized.
 await Promise.all(Array.from({length:Math.min(4,workloads.length)},async()=>{
  for(;;){const i=next++;if(i>=workloads.length)return;const workload=workloads[i];
   if(!pending.has(workload.sha256))pending.set(workload.sha256,fetchArtifact(workload,options).catch(error=>{options.diagnostic?.('Could not download '+workload.id+': '+error.message+'; building from source');return null}));
   const available=await pending.get(workload.sha256);
   if(available)results[i]={...workload,artifact:available.artifact,artifactName:workload.artifactName||basename(workload.artifact||available.artifact)};
  }
 }));
 for(let i=0;i<workloads.length;i++)if(!results[i]){
  results[i]=await options.build(workloads[i]);if(!results[i])throw Error('No artifact or source recipe is available: '+workloads[i].id);
 }
 return results;
}
export async function artifactCatalogue(prefix,{origin='https://wasm.fyi',fetchImpl=fetch}={}){
 const entries=[];let cursor='';
 do{
  const url=new URL('/api/artifacts',artifactOrigin(origin));url.searchParams.set('prefix',prefix);url.searchParams.set('limit','500');if(cursor)url.searchParams.set('cursor',cursor);
  const response=await artifactRequest(url,fetchImpl,15000);if(response.status===404)return [];
  if(!response.ok)throw Error('Artifact catalogue HTTP '+response.status);
  // Bound metadata independently of the binary download limit.
  const text=await response.text();if(text.length>16<<20)throw Error('Artifact catalogue exceeds size limit');
  const page=parseCorpusJSON(text);if(!Array.isArray(page.artifacts)||page.artifacts.length>500)throw Error('Invalid artifact catalogue');
  entries.push(...page.artifacts);if(entries.length>10000)throw Error('Too many artifact contracts');if(page.next&&page.next===cursor)throw Error('Artifact pagination did not advance');cursor=page.next||'';
 }while(cursor);
 return entries;
}
