import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {wasmedgeJITUnavailable} from './lib/wasmedge-sdk.mjs';
import {assertHistoricalRuntime} from './lib/historical-binding.mjs';
test('distinguishes an SDK without JIT from an unrecognized API layout',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmedge-jit-policy-'));
 try {
  const directory=join(root,'include/api/wasmedge');await mkdir(directory,{recursive:true});
  await mkdir(join(root,'include/common'),{recursive:true});await writeFile(join(root,'include/common/enum.inc'),'R(Interpreter)\nR(AOT)\n');
  const header=join(directory,'wasmedge.h');await writeFile(header,'WasmEdge_ConfigureCreate();');
  const proof=await wasmedgeJITUnavailable(root,'wasmedge-jit');assert.match(proof.reason,/no JIT run mode/);assert.match(proof.headers['wasmedge.h'],/^[a-f0-9]{64}$/);
  assert.equal(await wasmedgeJITUnavailable(root,'wasmedge'),null);
  await writeFile(header,'WasmEdge_ConfigureCreate(); WasmEdge_ConfigureSetRunMode();');assert.equal(await wasmedgeJITUnavailable(root,'wasmedge-jit'),null);
  await writeFile(header,'an unrecognized API');await assert.rejects(wasmedgeJITUnavailable(root,'wasmedge-jit'),/layout changed/);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('release qualification verifies the selected Wasmer compiler',()=>{
 const binding={engine:'wasmer',configuration:'wasmer-llvm',version:'7.0.0',source:{}};
 assert.doesNotThrow(()=>assertHistoricalRuntime({id:'wasmer-llvm',description:{runtime_version:'7.0.0',backend:'llvm-jit'}},binding));
 assert.throws(()=>assertHistoricalRuntime({id:'wasmer-llvm',description:{runtime_version:'7.0.0',backend:'singlepass-jit'}},binding),/compiler backend/);
});
test('C transpiler release identity includes the actual translator binary',()=>{
 const hash='a'.repeat(64),binding={engine:'wasm2c',configuration:'wasm2c-gcc',version:'1.0.42',source:{sdk:{translatorSha256:hash}}};
 const runtime={id:'wasm2c-gcc',description:{runtime_version:'wasm2c-gcc:'+hash,backend:'c-aot',effective_configuration:{translator_sha256:hash}}};
 assert.doesNotThrow(()=>assertHistoricalRuntime(runtime,binding));
 assert.throws(()=>assertHistoricalRuntime({...runtime,description:{...runtime.description,effective_configuration:{translator_sha256:'b'.repeat(64)}}},binding),/transpiler binary/);
});
