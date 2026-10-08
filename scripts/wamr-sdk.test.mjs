import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {wamrBuildFlags,wamrArchitectureUnavailable} from './lib/wamr-sdk.mjs';
test('builds distinct eager backends with compatible feature combinations',()=>{
 const interp=wamrBuildFlags('wamr'),fast=wamrBuildFlags('wamr-fast-jit'),llvm=wamrBuildFlags('wamr-llvm-jit','/llvm/lib/cmake/llvm');
 assert.ok(interp.includes('-DWAMR_BUILD_FAST_INTERP=1'));assert.ok(interp.includes('-DWAMR_BUILD_JIT=0'));
 assert.ok(fast.includes('-DWAMR_BUILD_FAST_JIT=1'));assert.ok(fast.includes('-DWAMR_BUILD_SIMD=0'));assert.ok(fast.includes('-DWAMR_BUILD_GC=0'));
 assert.ok(llvm.includes('-DWAMR_BUILD_JIT=1'));assert.ok(llvm.includes('-DLLVM_DIR=/llvm/lib/cmake/llvm'));
 for(const flags of [interp,fast,llvm]){assert.ok(flags.includes('-DWAMR_BUILD_LAZY_JIT=0'));assert.ok(flags.includes('-DWAMR_BUILD_EXCE_HANDLING=0'));assert.ok(flags.includes('-DWAMR_BUILD_LIBC_WASI=0'));}
 assert.throws(()=>wamrBuildFlags('wamr-llvm-jit'),/explicit LLVM/);
});
test('proves Fast JIT architecture gaps from the exact SDK build rules',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wamr-arch-'));
 try{const path=join(root,'core/iwasm/fast-jit');await mkdir(path,{recursive:true});await writeFile(join(path,'iwasm_fast_jit.cmake'),'if (WAMR_BUILD_TARGET STREQUAL "X86_64")\nelse()\nmessage(FATAL_ERROR "Fast JIT codegen for target ${WAMR_BUILD_TARGET} isn\'t implemented")\nendif()');
  assert.match((await wamrArchitectureUnavailable(root,'wamr-fast-jit','arm64')).reason,/x86-64/);
  assert.equal(await wamrArchitectureUnavailable(root,'wamr-fast-jit','x64'),null);
  assert.equal(await wamrArchitectureUnavailable(root,'wamr-llvm-jit','arm64'),null);
  await writeFile(join(path,'iwasm_fast_jit.cmake'),'new architecture policy');await assert.rejects(wamrArchitectureUnavailable(root,'wamr-fast-jit','arm64'),/policy changed/);
 }finally{await rm(root,{recursive:true,force:true})}
});
