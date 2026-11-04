import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {copyHistoricalHarness} from './lib/historical-binding.mjs';

test('frozen harness copy retains ignored Rust analyzer source and its executable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wasmfyi-harness-copy-'));
 try{
  const base=join(directory,'base'),target=join(directory,'copy');await mkdir(base);
  execFileSync('git',['init','-q',base]);
  await writeFile(join(base,'.gitignore'),'bin/\ntarget/\n');
  for(const path of ['adapters/wasmtime/src/bin','adapters/wasmtime/target/release'])await mkdir(join(base,path),{recursive:true});
  await writeFile(join(base,'adapters/wasmtime/src/bin/wasm-analyze.rs'),'pinned analyzer source\n');
  await writeFile(join(base,'adapters/wasmtime/target/release/wasm-analyze'),'pinned analyzer executable\n');
  await copyHistoricalHarness(base,target);
  assert.equal(await readFile(join(target,'adapters/wasmtime/src/bin/wasm-analyze.rs'),'utf8'),'pinned analyzer source\n');
  assert.equal(await readFile(join(target,'adapters/wasmtime/target/release/wasm-analyze'),'utf8'),'pinned analyzer executable\n');
 }finally{await rm(directory,{recursive:true,force:true})}
});
