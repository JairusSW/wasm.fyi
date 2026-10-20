import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareLibWasmAdapter} from './lib/libwasm-adapter.mjs';

test('historical LibWasm result vectors are adapted per SDK without mutating the frozen template',async()=>{
 const root=await mkdtemp(join(tmpdir(),'libwasm-adapter-'));
 try{
  const template=join(root,'template');await mkdir(join(template,'src'),{recursive:true});
  const memory='if(memory->data().contiguous_bytes_from(0,*n)!=*n)throw std::runtime_error("unsupported: segmented linear-memory view");';
  const original='auto f(){ Vector<Wasm::Value,Wasm::ResultsStaticSize> result; '+memory+' }\n';
  await writeFile(join(template,'src/libwasm.cpp'),original);await writeFile(join(template,'Cargo.toml'),'[package]\nname="fixture"\nversion="0.0.0"\n');
  const old=await prepareLibWasmAdapter(template,join(root,'old'),'constexpr inline size_t ArgumentsStaticSize = 3;');
  assert.equal(old.receipt.policy,'dynamic-result-vector+legacy-contiguous-memory');
  const oldSource=await readFile(join(old.root,'src/libwasm.cpp'),'utf8');
  assert.match(oldSource,/Vector<Wasm::Value> result/);assert.doesNotMatch(oldSource,/contiguous_bytes_from/);
  assert.equal(await readFile(join(template,'src/libwasm.cpp'),'utf8'),original);
  const current=await prepareLibWasmAdapter(template,join(root,'current'),'constexpr inline size_t ResultsStaticSize = 1; size_t contiguous_bytes_from(size_t,size_t);');
  assert.equal(current.receipt.policy,'current-api');assert.equal(await readFile(join(current.root,'src/libwasm.cpp'),'utf8'),original);
 }finally{await rm(root,{recursive:true,force:true})}
});
