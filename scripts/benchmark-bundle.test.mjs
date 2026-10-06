import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from './lib/wasmbench.mjs';
import {readParentBundleMetadata,verifyParentBundle} from './lib/benchmark-bundle.mjs';
test('parent source manifest bounds paths, identities and actual archive bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-parent-'));
 try{
  const plan={id:'session',identity:'source-plan',machine:'host'},metadata=Buffer.from(JSON.stringify({planSha256:plan.identity})),parts=[Buffer.from('first original part'),Buffer.from('second original part')];
  const index={schema:1,id:plan.id,machine:plan.machine,metadata:'metadata.json',metadataSha256:digest(metadata),bytes:parts.reduce((n,b)=>n+b.length,0),sha256:digest(Buffer.concat(parts)),parts:parts.map((b,i)=>({path:`bundle.tar.gz.part-${String(i).padStart(3,'0')}`,sha256:digest(b),bytes:b.length}))};
  const save=async(value=index)=>writeFile(join(root,'index.json'),JSON.stringify(value));
  await save();await writeFile(join(root,'metadata.json'),metadata);for(const [i,b]of parts.entries())await writeFile(join(root,index.parts[i].path),b);
  assert.deepEqual(await verifyParentBundle(root,plan),index);
  assert((await readParentBundleMetadata(root,plan)).metadataBytes.equals(metadata));
  const legacy={...index};delete legacy.metadataSha256;await save(legacy);assert.deepEqual(await verifyParentBundle(root,plan),legacy);await save();
  await assert.rejects(readParentBundleMetadata(root,{...plan,machine:'other'}),/another plan or machine/);
  for(const changed of [{...index,metadata:'../outside.json'},{...index,parts:[{...index.parts[0],path:'../outside'}]},{...index,bytes:index.bytes+1},{...index,parts:[{...index.parts[0],bytes:32*1024*1024+1}]}]){await save(changed);await assert.rejects(verifyParentBundle(root,plan),/Invalid|Unsafe|mismatch/)}
  await save();await writeFile(join(root,index.parts[1].path),'tampered');await assert.rejects(verifyParentBundle(root,plan),/size mismatch|digest mismatch/);
  await rm(join(root,index.parts[1].path));await symlink(join(root,index.parts[0].path),join(root,index.parts[1].path));await assert.rejects(verifyParentBundle(root,plan),/Unsafe/);
  await writeFile(join(root,'metadata.json'),Buffer.alloc(256*1024+1));await assert.rejects(readParentBundleMetadata(root,plan),/oversized/);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('parent verification cancellation closes its active archive file and permits retry',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-parent-cancel-'));
 try{
  const original=Buffer.alloc(8*1024*1024,17),metadata=Buffer.from(JSON.stringify({planSha256:'source-plan'}));
  const index={schema:1,id:'session',machine:'host',metadata:'metadata.json',metadataSha256:digest(metadata),bytes:original.length,sha256:digest(original),parts:[{path:'bundle.tar.gz.part-000',bytes:original.length,sha256:digest(original)}]};
  await writeFile(join(root,'index.json'),JSON.stringify(index));await writeFile(join(root,'metadata.json'),metadata);await writeFile(join(root,index.parts[0].path),original);
  const controller=new AbortController(),reason=new Error('stop archive verification');
  const probe=await open(join(root,index.parts[0].path),'r'),prototype=Object.getPrototypeOf(probe),originalStream=prototype.createReadStream;await probe.close();
  let active,stream;
  const mocked=t.mock.method(prototype,'createReadStream',function(options){
   active=this;stream=originalStream.call(this,options);stream.once('data',()=>controller.abort(reason));return stream;
  });
  await assert.rejects(verifyParentBundle(root,undefined,{signal:controller.signal}),error=>error===reason||error.name==='AbortError');
  assert(controller.signal.aborted);assert.equal(active.fd,-1,'Canceled archive file remained open');assert(stream.destroyed,'Canceled stream remained live');
  mocked.mock.restore();
  assert.deepEqual(await verifyParentBundle(root),index,'Cancellation changed retry source');
  const stopped=new AbortController();stopped.abort(reason);
  await assert.rejects(readParentBundleMetadata(join(root,'absent'),undefined,{signal:stopped.signal}),error=>error===reason);
 }finally{await rm(root,{recursive:true,force:true})}
});
