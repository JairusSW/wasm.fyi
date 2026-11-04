import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withWasmiProposals,applyWasmiProposals} from './lib/wasmi-proposals.mjs';
const manifest='wasmi = { version = "=2.0.0", default-features = false, features = ["std", "validate", "portable-dispatch"] }\n';
const sdk='[features]\nauto-dispatch = []\nportable-dispatch = []\nmemory64 = []\nsimd = []\n';
test('selects auto dispatch exclusively and preserves shipped proposals',()=>{
 const updated=withWasmiProposals(manifest,sdk);
 for(const name of ['std','validate','auto-dispatch','memory64','simd'])assert(updated.includes('"'+name+'"'));
 assert(!updated.includes('portable-dispatch'));
 assert.equal(withWasmiProposals(updated,sdk),updated);
});
test('older source without auto dispatch retains its supported portable backend',()=>{
 const updated=withWasmiProposals(manifest,sdk.replace('auto-dispatch = []\n',''));
 assert(updated.includes('portable-dispatch'));assert(!updated.includes('auto-dispatch'));
});
test('binding upgrades the recorded dispatch label and is repeatable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-wasmi-dispatch-'));
 try{
  await mkdir(join(root,'adapters/native/src'),{recursive:true});await mkdir(join(root,'sdk'));
  await writeFile(join(root,'sdk/Cargo.toml'),sdk);await writeFile(join(root,'adapters/native/Cargo.toml'),manifest);
  const path=join(root,'adapters/native/src/main.rs');await writeFile(path,'"portable-dispatch; eager bytecode; no fuel; source-implemented proposals: memory64,simd"');
  await applyWasmiProposals(root,join(root,'sdk'));await applyWasmiProposals(root,join(root,'sdk'));
  assert.equal(await readFile(path,'utf8'),'"auto-dispatch; eager bytecode; no fuel; source-implemented proposals: memory64,simd"');
 }finally{await rm(root,{recursive:true,force:true})}
});
