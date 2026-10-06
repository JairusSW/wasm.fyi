import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
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
