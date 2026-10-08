import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cloneFiles} from './lib/copy.mjs';
test('batched dataset copies preserve all bytes and independent writes across batches',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-batch-copy-'));
 try{
  const source=join(root,'source with spaces'),dest=join(root,'destination');await mkdir(source);
  const names=Array.from({length:205},(_,i)=>`${i} evidence.json`);
  for(const name of names)await writeFile(join(source,name),name);
  await cloneFiles(source,dest,names);
  assert.equal((await readdir(dest)).length,names.length);
  for(const name of names)assert.equal(await readFile(join(dest,name),'utf8'),name);
  await writeFile(join(dest,names[0]),'changed');
  assert.equal(await readFile(join(source,names[0]),'utf8'),names[0]);
 }finally{await rm(root,{recursive:true,force:true});}
});
