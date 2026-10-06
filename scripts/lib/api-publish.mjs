import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile, lstat} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import {digest} from './wasmbench.mjs';
import {lockedPlanBytes} from './benchmark-plan.mjs';
import {prepareParentArchive} from './api-parent-archive.mjs';
import {readParentBundleMetadata} from './benchmark-bundle.mjs';
const HASH=/^[a-f0-9]{64}$/;
const CHUNK=256*1024;
const BLOB=16*1024*1024;
export function publicationURL(value){
  const url=new URL(value);
  assert(!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/', 'API URL must be an origin without credentials');
  assert(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)), 'Use HTTPS except for a local API');
  return url.origin;
}
async function regularFile(path, ceiling, signal){
  signal?.throwIfAborted();
  const info=await lstat(path);assert(info.isFile()&&!info.isSymbolicLink()&&info.size<=ceiling,'Invalid or oversized publication file');
  return readFile(path,{signal});
}
function inside(root,path){
  assert(typeof path==='string'&&!path.includes('\\')&&!path.split('/').some(p=>p==='.'||p==='..'||p===''), 'Unsafe export path');
  const absolute=resolve(root,path);assert(absolute.startsWith(resolve(root)+sep),'Export outside session member');return absolute;
}
export async function publishCompletedJob({url,local,plan,machine,result,signal,token=process.env.WASMFYI_ADMIN_TOKEN,request=fetch}){
  signal?.throwIfAborted();
  url=publicationURL(url);assert(typeof token==='string'&&token.length>=32,'WASMFYI_ADMIN_TOKEN must contain at least 32 characters');
  assert(result.plan===plan.identity&&HASH.test(plan.identity)&&Array.isArray(result.siteExports)&&result.siteExports.length>0&&result.siteExports.length<=8,'Missing completed-job exports');
  assert(result.finished&&['PASS','FAIL','UNSUPPORTED','NOT MEASURED'].includes(result.verdict),'Incomplete attempt cannot publish');
  const exports=[],objects=new Map();
  const lockedPlan=lockedPlanBytes(plan);
  assert(lockedPlan.length>0&&lockedPlan.length<=16*1024*1024&&digest(lockedPlan)===plan.identity,'Session plan differs from locked identity or exceeds ceiling');
  assert(plan.schema===1&&Array.isArray(plan.machines)&&Array.isArray(plan.jobs)&&plan.machines.some(m=>m.name===machine)&&plan.jobs.some(j=>j.id===result.corpus),'Completed job outside session plan');
  const sessionPlan={schema:1,bytes:lockedPlan.length,chunks:[]};
  for(let offset=0;offset<lockedPlan.length;offset+=1024*1024){
    const body=lockedPlan.subarray(offset,offset+1024*1024),object={sha256:digest(body),bytes:body.length,kind:'binary'};
    sessionPlan.chunks.push(object);objects.set(object.sha256,{...object,body});
  }
  for(const path of result.siteExports){
    signal?.throwIfAborted();
    assert(path.startsWith(`jobs/${result.corpus}/exports/`),'Wrong completed corpus export');
    const directory=inside(local,path);
    // Walk only the path's ancestors, rejecting symlinked directories too.
    let parent=resolve(local);for(const part of path.split('/')){signal?.throwIfAborted();parent=join(parent,part);assert(!(await lstat(parent)).isSymbolicLink(),'Symlinked export path');}
    const bytes=await regularFile(join(directory,'manifest.json'),CHUNK,signal),manifest=JSON.parse(bytes);
    assert(manifest.schema===2&&manifest.format==='site-v2'&&manifest.verification==='source-recomputed'&&Array.isArray(manifest.objects)&&manifest.objects.length<=512,'Invalid producer export');
    // Avoid normalizing source bytes or reconstructing scientific results.
    assert(Buffer.from(JSON.stringify(manifest)).equals(bytes),'Manifest must use canonical producer encoding');
    const inventoryPages=manifest.inventoryPages??[];
    assert(Array.isArray(inventoryPages)&&inventoryPages.length<=512&&!(manifest.objects.length&&inventoryPages.length)&&(manifest.objects.length||inventoryPages.length),'Invalid inventory shape');
    const descriptors=[...manifest.objects],seen=new Set();
    for(const page of inventoryPages){
      signal?.throwIfAborted();
      assert(HASH.test(page.sha256)&&Number.isSafeInteger(page.bytes)&&page.bytes>0&&page.bytes<=CHUNK&&Number.isSafeInteger(page.objects)&&page.objects>0&&page.objects<=512&&Number.isSafeInteger(page.contentBytes)&&page.contentBytes>=0&&page.contentBytes<=page.objects*BLOB&&!seen.has(page.sha256),'Invalid inventory commitment');
      seen.add(page.sha256);
      assert(!(await lstat(join(directory,'objects'))).isSymbolicLink(),'Symlinked object directory');
      const path=join(directory,'objects',page.sha256),bytes=await regularFile(path,CHUNK,signal);
      assert(bytes.length===page.bytes&&digest(bytes)===page.sha256,'Inventory differs from root');
      const inventory=JSON.parse(bytes);
      assert(inventory.schema===1&&Array.isArray(inventory.objects)&&inventory.objects.length===page.objects&&inventory.objects.reduce((total,o)=>total+o.bytes,0)===page.contentBytes,'Inventory totals differ');
      const previous=objects.get(page.sha256);assert(!previous||(previous.bytes===page.bytes&&previous.kind==='inventory'),'Conflicting shared inventory');
      objects.set(page.sha256,{path,bytes:page.bytes,kind:'inventory'});
      descriptors.push(...inventory.objects);
    }
    for(const object of descriptors){
      signal?.throwIfAborted();
      assert(HASH.test(object.sha256)&&Number.isSafeInteger(object.bytes)&&object.bytes>=(object.kind==='binary'?0:1)&&object.bytes<=(object.kind==='binary'?BLOB:CHUNK)&&['record','evidence','binary'].includes(object.kind)&&!seen.has(object.sha256),'Invalid object reference');
      seen.add(object.sha256);
      assert(!(await lstat(join(directory,'objects'))).isSymbolicLink(),'Symlinked object directory');
      const path=join(directory,'objects',object.sha256);const b=await regularFile(path,object.kind==='binary'?BLOB:CHUNK,signal);
      assert(b.length===object.bytes&&digest(b)===object.sha256,'Export content differs from producer manifest');
      const previous=objects.get(object.sha256);assert(!previous||(previous.bytes===object.bytes&&previous.kind===object.kind),'Conflicting shared object');objects.set(object.sha256,{path,bytes:object.bytes,kind:object.kind});
    }
    exports.push({sha256:digest(bytes),manifest});
  }
  signal?.throwIfAborted();
  const parentSource=await readParentBundleMetadata(join(local,'bundle'),{...plan,machine});
  const {index:parentIndex,indexBytes:parent}=parentSource;
  assert(HASH.test(parentIndex.metadataSha256),'Parent metadata digest required for API publication');
  const {parent:parentArchive,objects:parentObjects}=await prepareParentArchive(join(local,'bundle'),parentSource,{signal});
  for(const object of parentObjects){const previous=objects.get(object.sha256);assert(!previous||(previous.bytes===object.bytes&&previous.kind===object.kind),'Parent object conflicts with measurement export');objects.set(object.sha256,object);}
  const job={schema:2,session:plan.id,machine,corpus:result.corpus,attempt:digest(Buffer.from(JSON.stringify([exports.map(e=>e.sha256),digest(Buffer.from(JSON.stringify(parentArchive))),digest(Buffer.from(JSON.stringify(sessionPlan)))]))),plan:plan.identity,configuredHarnessPin:plan.configuredHarnessPin,parentBundleSha256:digest(parent),parentArchive,sessionPlan,status:'completed',exports};
  assert(typeof job.configuredHarnessPin==='string'&&job.configuredHarnessPin.length>0,'Missing configured harness identity');
  const call=async(path,method='GET',body)=>{
    signal?.throwIfAborted();
    // This deadline covers every retry, delay and response read together.
    // The API rejects rate-limited requests before publication/upload work.
    const requestSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)]);
    for(;;){
      requestSignal.throwIfAborted();
      const response=await request(url+path,{method,body,redirect:'error',signal:requestSignal,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':Buffer.isBuffer(body)?'application/octet-stream':'application/json'}:{})}});
      if(response.status===429){
        const retry=response.headers.get('Retry-After');
        await response.body?.cancel();
        assert(retry&&/^[0-9]+$/.test(retry)&&Number(retry)>=1&&Number(retry)<=30,'Invalid API publication retry delay');
        await delay(Number(retry)*1000,undefined,{signal:requestSignal});
        continue;
      }
      if(!response.ok)throw Error(`API publication failed (${response.status}) at ${path}`);
      const chunks=[];let size=0;for await(const b of response.body){size+=b.length;assert(size<=1024*1024,'API response exceeds ceiling');chunks.push(b)};return JSON.parse(Buffer.concat(chunks).toString());
    }
  };
  const submitted=await call('/admin/v1/imports','POST',JSON.stringify(job));assert(HASH.test(submitted.id),'Invalid import identity');
  // The missing inventory shrinks as uploads arrive. Always request its first
  // page; using a moving offset would skip objects after the previous upload.
  for(let page=0;page<=objects.size+1;page++){
    const missing=await call(`/admin/v1/imports/${submitted.id}/missing`);
    assert(Array.isArray(missing.items)&&missing.items.length<=100,'Unbounded missing inventory');
    if(!missing.items.length){assert(missing.complete,'Incomplete empty inventory');const committed=await call(`/admin/v1/imports/${submitted.id}/commit`,'POST');assert(HASH.test(committed.revision),'Invalid published revision');return committed.revision;}
    for(const o of missing.items){const localObject=objects.get(o.sha256);assert(localObject&&localObject.bytes===o.bytes,'API requested undeclared content');await call(`/admin/v1/objects/${o.sha256}`,'PUT',localObject.body??await regularFile(localObject.path,localObject.kind==='binary'?BLOB:CHUNK,signal));if(localObject.kind==='inventory')await call(`/admin/v1/imports/${submitted.id}/inventories/${o.sha256}`,'POST');}
  }
  throw Error('API missing inventory failed to converge');
}
