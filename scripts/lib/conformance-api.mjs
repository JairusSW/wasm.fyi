import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rename,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {verifyConformanceArchive,conformanceSummary} from './conformance-archive.mjs';
import {digest} from './wasmbench.mjs';
import {publicationClient} from './api-publish.mjs';
const CHUNK=1024*1024,HASH=/^[a-f0-9]{64}$/;
async function regular(path,ceiling,signal){signal?.throwIfAborted();const info=await lstat(path);assert(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=ceiling,'Invalid conformance publication file');return readFile(path,{signal})}

const project=value=>value&&Object.keys(value).some(key=>['repository','revision','tag','version','sha256','assetSha256','url','label'].includes(key))?Object.fromEntries(['repository','revision','tag','version','sha256','assetSha256','url','label'].filter(key=>typeof value[key]==='string').map(key=>[key,value[key]])):null;

// Producer attestations describe reported suite outcomes; the API independently
// verifies content integrity. No benchmark controller or archived tool executes.
export async function exportConformanceArchive({bytes,receipt,directory,signal}){
  signal?.throwIfAborted();const {report,sha256,receiptSha256}=verifyConformanceArchive(bytes,receipt);
  const reportId=digest(Buffer.from(JSON.stringify(['conformance-v1',sha256,receiptSha256]))),temporary=directory+'.tmp-'+randomUUID();
  await mkdir(join(temporary,'objects'),{recursive:true});
  try{
    const descriptors=new Map();const object=async(kind,body)=>{signal?.throwIfAborted();const hash=digest(body),entry={sha256:hash,bytes:body.length,kind};if(!descriptors.has(hash)){await writeFile(join(temporary,'objects',hash),body);descriptors.set(hash,entry)}return entry};
    const record=async(kind,value)=>{const data=Buffer.from(JSON.stringify(value)),id=digest(data);assert(data.length+512<=(kind==='conformance-source'?256*1024:10*1024),'Conformance record exceeds descriptor budget');await object('record',Buffer.from(JSON.stringify({kind,id,data:value})));return id};
    const checksum=await object('binary',receipt),chunks=[];for(let start=0;start<bytes.length;start+=CHUNK){const chunk=await object('binary',bytes.subarray(start,start+CHUNK));chunks.push({sha256:chunk.sha256,bytes:chunk.bytes})}assert(chunks.length<=1024,'Conformance source exceeds transport ceiling');
    const sourceId=await record('conformance-source',{schema:1,reportId,sha256,bytes:bytes.length,chunks,receipt:{sha256:checksum.sha256,bytes:checksum.bytes},integrity:'content-hash-verified',collectionVerification:'publisher-asserted'});
    await record('conformance-context',{schema:1,sourceId,created:report.created,host:Object.fromEntries(['hostname','os','arch'].map(key=>[key,report.host[key]])),hostIdentity:digest(Buffer.from(JSON.stringify(report.host))),coverageCount:report.coverage?.length??null,interpretationSource:'publisher-asserted'});
    for(const row of report.coverage??[])await record('conformance-coverage',{schema:1,sourceId,created:report.created,engine:row.engine,status:row.status,reason:row.reason??null,interpretationSource:'publisher-asserted'});
    for(const lane of conformanceSummary(report,sha256).lanes){const value={schema:1,policy:'reported-suite-lanes-v1',sourceId,lane:lane.id,created:report.created,unit:lane.unit??null,status:lane.status??null,totals:lane.totals??null,engine:project(lane.engine),suite:project(lane.suite),reason:lane.reason??null,parserVersion:lane.parserVersion??null,interpretationSource:'publisher-asserted'};assert(Buffer.byteLength(JSON.stringify(value))+512<=10*1024,'Conformance lane descriptor exceeds budget');await record('conformance',value)}
    const payload=[...descriptors.values()],manifest={schema:2,format:'conformance-v1',reportId,sourceReportSha256:sha256,sourceSealSha256:receiptSha256,exporter:'wasm.fyi-conformance-export-v2',verification:'source-integrity-checked',objects:[]};
    if(payload.length<=512)manifest.objects=payload;else{manifest.inventoryPages=[];for(let start=0;start<payload.length;start+=512){const objects=payload.slice(start,start+512),body=Buffer.from(JSON.stringify({schema:1,objects})),hash=digest(body);await writeFile(join(temporary,'objects',hash),body);manifest.inventoryPages.push({sha256:hash,bytes:body.length,objects:objects.length,contentBytes:objects.reduce((n,o)=>n+o.bytes,0)})}}
    const manifestBytes=Buffer.from(JSON.stringify(manifest));await writeFile(join(temporary,'manifest.json'),manifestBytes);await rename(temporary,directory);
    return {manifest,sha256:digest(manifestBytes),sourceId};
  }finally{await rm(temporary,{recursive:true,force:true})}
}

export async function publishConformanceExport({directory,url,token=process.env.WASMFYI_ADMIN_TOKEN,request=fetch,signal}){
  signal?.throwIfAborted();for(const path of [directory,join(directory,'objects')]){const info=await lstat(path);assert(info.isDirectory()&&!info.isSymbolicLink(),'Invalid conformance export directory')}
  const manifestBytes=await regular(join(directory,'manifest.json'),256*1024,signal),manifest=JSON.parse(manifestBytes);
  assert(Buffer.from(JSON.stringify(manifest)).equals(manifestBytes),'Noncanonical conformance manifest');
  assert(Array.isArray(manifest.objects)&&manifest.objects.length<=512,'Unbounded conformance inventory');
  assert(Array.isArray(manifest.inventoryPages??[])&&(manifest.inventoryPages??[]).length<=512&&!(manifest.objects.length&&manifest.inventoryPages?.length)&&(manifest.objects.length||manifest.inventoryPages?.length),'Invalid conformance inventory shape');
  assert(manifest.schema===2&&manifest.format==='conformance-v1'&&manifest.verification==='source-integrity-checked'&&HASH.test(manifest.reportId),'Invalid conformance transport');
  const objects=new Map(),add=object=>{assert(HASH.test(object.sha256)&&['binary','record','inventory'].includes(object.kind)&&Number.isSafeInteger(object.bytes)&&object.bytes>=1&&object.bytes<=(object.kind==='binary'?CHUNK:256*1024),'Invalid conformance payload');assert(!objects.has(object.sha256),'Duplicate conformance payload');objects.set(object.sha256,{...object,path:join(directory,'objects',object.sha256)})};for(const page of manifest.inventoryPages||[]){assert(HASH.test(page.sha256)&&Number.isSafeInteger(page.objects)&&page.objects>=1&&page.objects<=512&&Number.isSafeInteger(page.contentBytes),'Invalid conformance inventory commitment');const path=join(directory,'objects',page.sha256),body=await regular(path,256*1024,signal);assert(body.length===page.bytes&&digest(body)===page.sha256,'Conformance inventory differs');const inventory=JSON.parse(body);assert(inventory.schema===1&&Array.isArray(inventory.objects)&&inventory.objects.length===page.objects&&inventory.objects.reduce((n,o)=>n+o.bytes,0)===page.contentBytes,'Conformance inventory count differs');add({...page,kind:'inventory'});for(const object of inventory.objects)add(object)}
  for(const object of manifest.objects)add(object);
  for(const object of objects.values()){signal?.throwIfAborted();assert(HASH.test(object.sha256)&&object.bytes>=1&&object.bytes<=(object.kind==='binary'?CHUNK:256*1024),'Invalid conformance payload');const info=await lstat(object.path);assert(info.isFile()&&!info.isSymbolicLink()&&info.size===object.bytes,'Invalid conformance publication file');const bytes=await regular(object.path,object.kind==='binary'?CHUNK:256*1024,signal);assert(digest(bytes)===object.sha256,'Changed conformance payload')}
  const sourceObjects=[...objects.values()].filter(o=>o.kind==='record');let reportHost;
  for(const object of sourceObjects){const record=JSON.parse(await readFile(object.path));if(record.kind==='conformance-source'){const parts=[];for(const chunk of record.data.chunks){const local=objects.get(chunk.sha256);assert(local?.kind==='binary','Missing conformance source chunk');parts.push(await readFile(local.path))}const body=Buffer.concat(parts);assert(body.length===record.data.bytes&&digest(body)===manifest.sourceReportSha256,'Changed conformance original');const receipt=objects.get(record.data.receipt.sha256);assert(receipt?.kind==='binary','Missing conformance receipt');reportHost=verifyConformanceArchive(body,await readFile(receipt.path)).report.host}}
  assert(reportHost,'Missing conformance source environment');
  const job={schema:3,kind:'conformance',session:'conformance-'+manifest.reportId,machine:'host-'+digest(Buffer.from(JSON.stringify(reportHost))),corpus:'suite-capture',attempt:manifest.sourceReportSha256,plan:digest(Buffer.from(JSON.stringify(['conformance-publication-v1',manifest.reportId]))),status:'completed',exports:[{sha256:digest(manifestBytes),manifest}]};
  const call=publicationClient({url,token,request,signal}),submitted=await call('/admin/v1/imports','POST',JSON.stringify(job));assert.equal(submitted.id,digest(Buffer.from(JSON.stringify(job))),'Conformance import identity differs');
  for(let page=0;page<=objects.size+1;page++){const missing=await call('/admin/v1/imports/'+submitted.id+'/missing');assert(Array.isArray(missing.items)&&missing.items.length<=100,'Unbounded conformance missing inventory');if(!missing.items.length){assert(missing.complete,'Incomplete conformance inventory');const result=await call('/admin/v1/imports/'+submitted.id+'/commit','POST');assert(HASH.test(result.revision),'Invalid conformance revision');return result.revision}for(const object of missing.items){const local=objects.get(object.sha256);assert(local&&local.bytes===object.bytes,'API requested undeclared conformance content');const body=await regular(local.path,local.kind==='binary'?CHUNK:256*1024,signal);assert(body.length===local.bytes&&digest(body)===local.sha256,'Changed conformance upload');await call('/admin/v1/objects/'+object.sha256,'PUT',body);if(local.kind==='inventory')await call('/admin/v1/imports/'+submitted.id+'/inventories/'+object.sha256,'POST')}}
  throw Error('Conformance import did not converge');
}
