import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {historyBuildKey,historyBuildDirectory} from './lib/history-build-cache.mjs';
test('shares compatible SDK builds while keeping incompatible backends separate',()=>{
 const pin={engine:'wasmtime',targetType:'main',revision:'a'.repeat(40),targetWeek:'2026-10-04'};
 assert.equal(historyBuildKey(pin,'wasmtime'),historyBuildKey({...pin,targetWeek:'2026-09-27'},'wasmtime-winch'));
 assert.notEqual(historyBuildKey(pin,'wasmtime'),historyBuildKey({...pin,revision:'b'.repeat(40)},'wasmtime'));
 assert.notEqual(historyBuildKey({...pin,engine:'wamr'},'wamr'),historyBuildKey({...pin,engine:'wamr'},'wamr-llvm-jit'));
 const wasmer={...pin,engine:'wasmer'};
 assert.equal(historyBuildKey(wasmer,'wasmer-singlepass'),historyBuildKey(wasmer,'wasmer-cranelift'));
 assert.notEqual(historyBuildKey(wasmer,'wasmer-singlepass'),historyBuildKey(wasmer,'wasmer-llvm'));
 const wizard={...pin,engine:'wizard'};
 assert.equal(historyBuildKey(wizard,'wizard-fast-int'),historyBuildKey(wizard,'wizard-spc'));
 assert.notEqual(historyBuildKey(wizard,'wizard-v3-int'),historyBuildKey(wizard,'wizard-spc'));
});
test('Cranelift reuses a source-pinned dual-compiler SDK but refuses a Singlepass-only cache',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmer-dual-sdk-'));
 try{
  const pin={engine:'wasmer',targetType:'main',revision:'a'.repeat(40)};
  const directory=join(root,'sdk-builds',historyBuildKey(pin,'wasmer-singlepass'));
  const harness=join(directory,'harness','wasmer');
  await mkdir(join(harness,'bin'),{recursive:true});
  await writeFile(join(directory,'wasmer-build.json'),JSON.stringify({root:harness}));
  assert.notEqual(await historyBuildDirectory(root,pin,'wasmer-cranelift'),directory);
  await writeFile(join(harness,'bin','adapter-wasmer-cranelift'),'source-pinned compiler executable');
  assert.equal(await historyBuildDirectory(root,pin,'wasmer-cranelift'),directory);
  assert.equal(await historyBuildDirectory(root,pin,'wasmer-singlepass'),directory);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('resumes an existing qualified SDK build without recompiling it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'history-sdk-'));
 try {
  const pin={engine:'wasmtime',targetType:'release',tag:'v49.0.2'},legacy=join(root,'engine-builds','wasmtime-v49.0.2-release-week');
  await mkdir(legacy,{recursive:true});await writeFile(join(legacy,'binding.json'),JSON.stringify({release:pin}));
  assert.equal(await historyBuildDirectory(root,pin,'wasmtime-winch'),legacy);
  assert.equal(await historyBuildDirectory(root,{...pin,tag:'v49.0.1'},'wasmtime'),join(root,'sdk-builds','wasmtime-release-v49.0.1'));
  const wamr={engine:'wamr',targetType:'release',tag:'v2.4.5'},jit=join(root,'engine-builds','wamr-llvm-jit-v2.4.5-release-week');
  await mkdir(jit,{recursive:true});await writeFile(join(jit,'binding.json'),JSON.stringify({release:wamr,configuration:'wamr-llvm-jit'}));
  assert.equal(await historyBuildDirectory(root,wamr,'wamr'),join(root,'sdk-builds','wamr-release-v2.4.5'));
 }finally{await rm(root,{recursive:true,force:true})}
});
