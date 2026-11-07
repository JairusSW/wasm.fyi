import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {customWorkloads} from './custom-workloads.mjs';
const wasm=Buffer.from('0061736d01000000','hex');
test('private modules are frozen, exact uint64 contracts retained, originals untouched',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-custom-'));
 try{
  const file=join(root,'my module.wasm');await writeFile(file,wasm);
  const [w]=await customWorkloads({wasm:[file],export:'run',wasmArgs:'[18446744073709551615]',expected:'["0"]'},join(root,'cache'));
  assert.equal(w.id,'custom/my-module');assert.deepEqual(w.args,['18446744073709551615']);assert.deepEqual(w.oracle.expected,['0']);
  await writeFile(file,'changed');assert.deepEqual(await readFile(w.artifact),wasm);
  await assert.rejects(()=>customWorkloads({wasm:[file],export:'run'},join(root,'cache')),/--expected/);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('manifests rebase relative inputs and reject mismatched modules',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-custom-'));
 try{
  await writeFile(join(root,'input.wasm'),wasm);const file=join(root,'manifest.json'),w={id:'custom/input',artifact:'input.wasm',export:'run',oracle:{kind:'exact_u64',expected:[]}};
  await writeFile(file,JSON.stringify([w]));assert.equal((await customWorkloads({manifests:[file]},join(root,'cache'))).length,1);
  await writeFile(file,JSON.stringify([{...w,sha256:'a'.repeat(64)}]));await assert.rejects(()=>customWorkloads({manifests:[file]},join(root,'cache')),/differs/);
 }finally{await rm(root,{recursive:true,force:true})}
});
