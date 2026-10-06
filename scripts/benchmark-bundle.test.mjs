import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
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
