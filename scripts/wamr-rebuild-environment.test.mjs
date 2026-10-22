import test from 'node:test';import assert from 'node:assert/strict';import {wamrRebuildEnvironment} from './lib/wamr-rebuild-environment.mjs';
test('recovers the recorded LLVM compiler and private libc without changing runtime env',()=>{
 const receipt={provenance:{sdk:{flags:['-DLLVM_DIR=/sdk/llvm/lib/cmake/llvm','-DCMAKE_EXE_LINKER_FLAGS=-Wl,--no-as-needed /sdk/libc/libc.so.6 -Wl,--as-needed'],compilerPrefix:'/sdk/compiler'}}};
 const base={PATH:'/usr/bin'},result=wamrRebuildEnvironment(receipt,base);
 assert.equal(result.LLVM_DIR,'/sdk/llvm/lib/cmake/llvm');assert.equal(result.WASMFYI_WAMR_CXX_SDK,'/sdk/compiler');assert.equal(result.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR,'/sdk/libc');assert.deepEqual(base,{PATH:'/usr/bin'});
 assert.equal(wamrRebuildEnvironment(receipt,{LLVM_DIR:'/explicit'}).LLVM_DIR,'/explicit');
});
