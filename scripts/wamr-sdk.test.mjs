import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {wamrBuildFlags,wamrArchitectureUnavailable,wamrLLVMCompilerFlags} from './lib/wamr-sdk.mjs';
test('LLVM runtime uses one private glibc for its transitive library dependencies',()=>{
 const flags=wamrLLVMCompilerFlags('/compiler',{WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'/runtime/lib'},'linux');
 for(const name of ['CMAKE_EXE_LINKER_FLAGS','CMAKE_SHARED_LINKER_FLAGS']){
  const value=flags.find(flag=>flag.startsWith('-D'+name+'='));
  assert(value.includes('-Wl,--disable-new-dtags'));assert(value.includes('-Wl,-rpath,/runtime/lib'));assert(value.includes('/runtime/lib/libc.so.6'));
 }
 assert(!wamrLLVMCompilerFlags('/compiler').some(flag=>flag.includes('/runtime/lib')));
});
test('private-glibc compiler executables link and start with the matching loader only on Linux',()=>{
 const env={WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'/runtime/lib'};
 const flags=wamrLLVMCompilerFlags('/compiler',env,'linux');
 const executable=flags.find(flag=>flag.startsWith('-DCMAKE_EXE_LINKER_FLAGS='));
 const shared=flags.find(flag=>flag.startsWith('-DCMAKE_SHARED_LINKER_FLAGS='));
 assert(executable.includes("-Wl,--no-as-needed '/runtime/lib/ld-linux-x86-64.so.2' -Wl,--as-needed"));
 assert(executable.includes('-Wl,--dynamic-linker,/runtime/lib/ld-linux-x86-64.so.2'));
 assert(!shared.includes('ld-linux'));
 for(const selected of [wamrLLVMCompilerFlags('/compiler',{},'linux'),wamrLLVMCompilerFlags('/compiler',env,'darwin')])assert(!selected.some(flag=>flag.includes('ld-linux')||flag.includes('--dynamic-linker')));
 assert.throws(()=>wamrLLVMCompilerFlags('/compiler',{WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'/unsafe path'},'linux'),/Unsafe/);
});
test('builds distinct eager backends with compatible feature combinations',()=>{
 const interp=wamrBuildFlags('wamr'),fast=wamrBuildFlags('wamr-fast-jit'),llvm=wamrBuildFlags('wamr-llvm-jit','/llvm/lib/cmake/llvm');
 assert.ok(interp.includes('-DWAMR_BUILD_FAST_INTERP=1'));assert.ok(interp.includes('-DWAMR_BUILD_JIT=0'));
 assert.ok(fast.includes('-DWAMR_BUILD_FAST_JIT=1'));assert.ok(fast.includes('-DWAMR_BUILD_SIMD=0'));assert.ok(fast.includes('-DWAMR_BUILD_GC=0'));
 assert.ok(llvm.includes('-DWAMR_BUILD_JIT=1'));assert.ok(llvm.includes('-DLLVM_DIR=/llvm/lib/cmake/llvm'));
 for(const flags of [interp,fast,llvm]){assert.ok(flags.includes('-DWAMR_BUILD_LAZY_JIT=0'));assert.ok(flags.includes('-DWAMR_BUILD_EXCE_HANDLING=0'));assert.ok(flags.includes('-DWAMR_BUILD_EXTENDED_CONST_EXPR=1'));assert.ok(flags.includes('-DWAMR_BUILD_LIBC_WASI=0'));}
 for(const flags of [interp,fast,llvm]){assert.ok(flags.includes('-DWAMR_BUILD_MEMORY64=1'));assert.ok(flags.includes('-DWAMR_BUILD_SHARED_MEMORY=1'));}
 assert.ok(interp.includes('-DWAMR_BUILD_MULTI_MEMORY=1'));assert.ok(fast.includes('-DWAMR_BUILD_MULTI_MEMORY=0'));assert.ok(llvm.includes('-DWAMR_BUILD_MULTI_MEMORY=0'));
 assert(!interp.includes('-DWAMR_BUILD_TAIL_CALL=1'));assert.ok(wamrBuildFlags('wamr',undefined,true).includes('-DWAMR_BUILD_TAIL_CALL=1'));
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
