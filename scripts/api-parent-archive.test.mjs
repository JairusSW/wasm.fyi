import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,stat} from 'node:fs/promises';
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
