import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,stat,utimes,open} from 'node:fs/promises';
import {watch} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {digest} from './lib/wasmbench.mjs';
import {readParentBundleMetadata} from './lib/benchmark-bundle.mjs';
import {prepareParentArchive} from './lib/api-parent-archive.mjs';
test('concurrent parent transports retain original bytes and reuse completed chunks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-parent-api-'));try{
  const bundle=join(root,'bundle'),cache=join(root,'cache');await mkdir(bundle);
  const original=Buffer.alloc(1024*1024+31,17),metadata=Buffer.from(JSON.stringify({planSha256:digest('plan')}));
  const index={schema:1,id:'session',machine:'host',metadata:'metadata.json',metadataSha256:digest(metadata),bytes:original.length,sha256:digest(original),parts:[{path:'bundle.tar.gz.part-000',bytes:original.length,sha256:digest(original)}]};
  await writeFile(join(bundle,'index.json'),JSON.stringify(index));await writeFile(join(bundle,'metadata.json'),metadata);await writeFile(join(bundle,index.parts[0].path),original);
  const source=await readParentBundleMetadata(bundle);
  const [first,second]=await Promise.all([prepareParentArchive(bundle,source,{cache}),prepareParentArchive(bundle,source,{cache})]);assert.deepEqual(first.parent,second.parent);
  const data=await Promise.all(first.parent.chunks.map(o=>readFile(join(cache,first.parent.index.sha256,o.sha256))));assert(Buffer.concat(data).equals(original));
  // A warm materialization needs the admitted index/metadata, not source archive
  // parts again; this preserves the original snapshot rather than new bytes.
  await rm(join(bundle,index.parts[0].path));assert.deepEqual((await prepareParentArchive(bundle,source,{cache})).parent,first.parent);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('cancel parent materialization after a chunk leaves no partial transport or temporary writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-parent-api-cancel-'));let watcher;
 try{
  const bundle=join(root,'bundle'),cache=join(root,'cache');await mkdir(bundle);
  const original=Buffer.alloc(16*1024*1024,19),metadata=Buffer.from(JSON.stringify({planSha256:digest('plan')}));
  const index={schema:1,id:'cancel-session',machine:'host',metadata:'metadata.json',metadataSha256:digest(metadata),bytes:original.length,sha256:digest(original),parts:[{path:'bundle.tar.gz.part-000',bytes:original.length,sha256:digest(original)}]};
  await writeFile(join(bundle,'index.json'),JSON.stringify(index));await writeFile(join(bundle,'metadata.json'),metadata);await writeFile(join(bundle,index.parts[0].path),original);
  const source=await readParentBundleMetadata(bundle),folder=join(cache,digest(source.indexBytes));await mkdir(folder,{recursive:true});
  const controller=new AbortController(),reason=new Error('stop parent materialization');
  watcher=watch(folder,(_event,name)=>{if(name&&/^[a-f0-9]{64}$/.test(String(name)))controller.abort(reason)});
  await assert.rejects(prepareParentArchive(bundle,source,{cache,signal:controller.signal}),error=>error===reason||error.name==='AbortError');
  watcher.close();watcher=undefined;
  const files=await readdir(folder);assert(controller.signal.aborted);assert(files.some(name=>/^[a-f0-9]{64}$/.test(name)),'No completed chunk reached cache');
  assert(!files.includes('transport.json'),'Canceled archive became a completed transport');assert(!files.some(name=>name.endsWith('.tmp')),'Canceled writes left temporary files');
  const recovered=await prepareParentArchive(bundle,source,{cache});
  const bytes=await Promise.all(recovered.parent.chunks.map(o=>readFile(join(folder,o.sha256))));assert(Buffer.concat(bytes).equals(original));
  const before=await stat(join(folder,'transport.json'));
  await assert.rejects(prepareParentArchive(bundle,source,{cache,signal:controller.signal}),error=>error===reason);
  assert.equal((await stat(join(folder,'transport.json'))).mtimeMs,before.mtimeMs,'Stopped warm lookup rewrote transport');
 }finally{watcher?.close();await rm(root,{recursive:true,force:true})}
});

test('parent cache damage is repaired from original bytes and never fabricated without source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-parent-cache-repair-'));
 try{
  const bundle=join(root,'bundle'),cache=join(root,'cache');await mkdir(bundle);
  const original=Buffer.alloc(1024*1024+31,23),metadata=Buffer.from(JSON.stringify({planSha256:digest('repair-plan')}));
  const index={schema:1,id:'repair-session',machine:'host',metadata:'metadata.json',metadataSha256:digest(metadata),bytes:original.length,sha256:digest(original),parts:[{path:'bundle.tar.gz.part-000',bytes:original.length,sha256:digest(original)}]};
  await writeFile(join(bundle,'index.json'),JSON.stringify(index));await writeFile(join(bundle,'metadata.json'),metadata);await writeFile(join(bundle,index.parts[0].path),original);
  const source=await readParentBundleMetadata(bundle),initial=await prepareParentArchive(bundle,source,{cache}),folder=join(cache,digest(source.indexBytes));
  const check=async()=>{
   const output=await prepareParentArchive(bundle,source,{cache});assert.deepEqual(output.parent,initial.parent);assert.equal(JSON.stringify(output.parent),JSON.stringify(initial.parent),'Cache encoding changed publication identity');
   for(const object of output.objects){const bytes=await readFile(object.path);assert.equal(bytes.length,object.bytes);assert.equal(digest(bytes),object.sha256,'Damaged cache returned as usable transport')}
  };
  await check();
  for(const object of [initial.parent.index,initial.parent.metadata,...initial.parent.chunks]){
   const path=join(folder,object.sha256);await rm(path);await check();
   await writeFile(path,Buffer.alloc(object.bytes,42));await check();
  }
  const changed=join(folder,initial.parent.chunks[0].sha256);
  await utimes(changed,1700000000,1700000000);await check();
  await writeFile(changed,Buffer.alloc(initial.parent.chunks[0].bytes,42));await utimes(changed,1700000000,1700000000);await check();
  const poisoned={...initial.parent,chunks:[{...initial.parent.chunks[0],sha256:digest(Buffer.alloc(initial.parent.chunks[0].bytes,42))},...initial.parent.chunks.slice(1)]};
  await writeFile(join(folder,poisoned.chunks[0].sha256),Buffer.alloc(poisoned.chunks[0].bytes,42));await writeFile(join(folder,'transport.json'),JSON.stringify(poisoned));await check();
  await writeFile(join(folder,'transport.json'),JSON.stringify({...initial.parent,extra:true}));await check();
  await writeFile(join(folder,'transport.json'),'x'.repeat(256*1024+1));await check();
  const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,value])=>[key,reverse(value)])):value;
  await writeFile(join(folder,'transport.json'),JSON.stringify(reverse(initial.parent)));await check();
  await rm(join(bundle,index.parts[0].path));await check();
  await rm(join(folder,initial.parent.chunks[0].sha256));
  await assert.rejects(prepareParentArchive(bundle,source,{cache}),/ENOENT|source|cache/,'Missing source cannot repair damaged cache');
 }finally{await rm(root,{recursive:true,force:true})}
});

test('parent cache receipts skip unchanged bodies and eviction forces fresh byte verification',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-parent-cache-receipts-'));
 try{
  const archive=Buffer.from('unchanged original archive'),sources=[];
  for(let i=0;i<9;i++){
   const bundle=join(root,'bundle-'+i);await mkdir(bundle);
   const metadata=Buffer.from(JSON.stringify({planSha256:digest('receipt-plan-'+i)}));
   const index={schema:1,id:'receipt-session-'+i,machine:'host',metadata:'metadata.json',metadataSha256:digest(metadata),bytes:archive.length,sha256:digest(archive),parts:[{path:'bundle.tar.gz.part-000',bytes:archive.length,sha256:digest(archive)}]};
   await writeFile(join(bundle,'index.json'),JSON.stringify(index));await writeFile(join(bundle,'metadata.json'),metadata);await writeFile(join(bundle,index.parts[0].path),archive);
   sources.push({bundle,source:await readParentBundleMetadata(bundle)});
  }
  const cache=join(root,'cache'),first=sources[0],original=await prepareParentArchive(first.bundle,first.source,{cache});
  const probe=await open(join(first.bundle,'index.json'),'r'),prototype=Object.getPrototypeOf(probe),read=prototype.read;await probe.close();let reads=0;
  const mocked=t.mock.method(prototype,'read',function(...args){reads++;return read.apply(this,args)});
  await rm(join(first.bundle,'bundle.tar.gz.part-000'));
  assert.deepEqual((await prepareParentArchive(first.bundle,first.source,{cache})).parent,original.parent);assert(reads<=2,'Unchanged receipt reread cached bodies');
  for(const member of sources.slice(1))await prepareParentArchive(member.bundle,member.source,{cache});
  reads=0;assert.deepEqual((await prepareParentArchive(first.bundle,first.source,{cache})).parent,original.parent);assert(reads>2,'Evicted receipt skipped fresh cached-byte verification');
  mocked.mock.restore();
 }finally{await rm(root,{recursive:true,force:true})}
});

test('real archived parent cache reuses verified bytes and repairs a corrupted chunk',async(t)=>{
 const bundle=process.env.WASMFYI_REAL_PARENT_BUNDLE;if(!bundle){t.skip('Set WASMFYI_REAL_PARENT_BUNDLE for archived-byte gate');return}
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-real-parent-cache-'));
 try{
  const source=await readParentBundleMetadata(bundle),cache=join(root,'cache'),initial=await prepareParentArchive(bundle,source,{cache});
  const probe=await open(initial.objects[0].path,'r'),prototype=Object.getPrototypeOf(probe),read=prototype.read;await probe.close();let reads=0;
  const mocked=t.mock.method(prototype,'read',function(...args){reads++;return read.apply(this,args)});
  for(let i=0;i<100;i++)assert.deepEqual((await prepareParentArchive(bundle,source,{cache})).parent,initial.parent);
  assert(reads<=200,'Warm real cache reread archived chunk bodies');mocked.mock.restore();
  const tail=initial.objects.at(-1),bytes=await readFile(tail.path);bytes[bytes.length-1]^=1;await writeFile(tail.path,bytes);
  const repaired=await prepareParentArchive(bundle,source,{cache});assert.deepEqual(repaired.parent,initial.parent);assert.equal(digest(await readFile(tail.path)),tail.sha256);
  t.diagnostic(`Verified ${source.index.bytes} original archive bytes; ${initial.parent.chunks.length} chunks; 100 warm calls; repaired corrupted tail`);
 }finally{await rm(root,{recursive:true,force:true})}
});
