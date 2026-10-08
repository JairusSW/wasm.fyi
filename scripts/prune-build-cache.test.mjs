import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {pruneRustIntermediates} from './lib/prune-build-cache.mjs';
import {execFileSync} from 'node:child_process';
test('removes compiler objects while preserving adapters, analyzers and SDK libraries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prune-sdk-'));
 try{
  const target=join(root,'adapters/native/target/wasmi/release'),wt=join(root,'adapters/wasmtime/target/release');
  for(const p of [join(target,'deps'),join(wt,'build'),join(root,'toolchains/sdk/lib')])await mkdir(p,{recursive:true});
  for(const p of [join(target,'deps/object.rlib'),join(target,'adapter-native'),join(wt,'wasm-analyze'),join(root,'toolchains/sdk/lib/libiwasm.so')])await writeFile(p,'keep-or-prune');
  await pruneRustIntermediates(root);
  assert.equal(await stat(join(target,'deps')).catch(()=>null),null);
  for(const p of [join(target,'adapter-native'),join(wt,'wasm-analyze'),join(root,'toolchains/sdk/lib/libiwasm.so')])assert.equal(await readFile(p,'utf8'),'keep-or-prune');
 }finally{await rm(root,{recursive:true,force:true})}
});
test('binding source roots shared across backends do not stop the cache watcher',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prune-shared-sdk-'));
 try{
  for(const backend of ['wasmtime','wasmtime-winch']){
   const directory=join(root,'engine-builds',backend),target=join(directory,'harness/adapters/wasmtime/target/release');
   await mkdir(join(target,'deps'),{recursive:true});
   await writeFile(join(target,'deps/object.rlib'),'object');
   await writeFile(join(target,'adapter-wasmtime'),'binary');
   await writeFile(join(directory,backend==='wasmtime'?'binding.json':'wasmtime-build.json'),JSON.stringify({root:join(root,'engine-builds/wasmtime/harness/wasmtime')}));
  }
  const output=JSON.parse(execFileSync(process.execPath,[new URL('./prune-history-builds.mjs',import.meta.url).pathname,root],{encoding:'utf8'}));
  assert.equal(output.prunedBuilds,2);
  for(const backend of ['wasmtime','wasmtime-winch']){
   const target=join(root,'engine-builds',backend,'harness/adapters/wasmtime/target/release');
   assert.equal(await stat(join(target,'deps')).catch(()=>null),null);
   assert.equal(await readFile(join(target,'adapter-wasmtime'),'utf8'),'binary');
  }
 }finally{await rm(root,{recursive:true,force:true})}
});
