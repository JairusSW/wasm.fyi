import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {configureWamrLLVMSharedLink} from './lib/wamr-sdk.mjs';

test('shared LLVM SDK builds without optional GPU libraries; static SDK requirements stay enforced',async t=>{
 if(process.env.WASMFYI_WAMR_LINK_INTEGRATION!=='1'){t.skip('Native compilation requires an idle host or its measurement lock');return;}
 const root=await mkdtemp(join(tmpdir(),'wamr-llvm-link-'));
 try{
  const source=join(root,'product-mini/platforms',process.platform);await mkdir(source,{recursive:true});
  await writeFile(join(source,'stub.c'),'int runtime_stub(void) { return 1; }\n');
  await writeFile(join(source,'CMakeLists.txt'),`cmake_minimum_required(VERSION 3.16)
project(wamr_link_regression LANGUAGES C)
option(LLVM_LINK_LLVM_DYLIB "LLVM package shared-link mode" ON)
add_library(LLVM INTERFACE)
add_library(optional_gpu SHARED IMPORTED)
set_target_properties(optional_gpu PROPERTIES IMPORTED_LOCATION "${root}/missing-gpu.so")
set(LLVM_AVAILABLE_LIBS LLVM optional_gpu)
add_library(vmlib SHARED stub.c)
target_link_libraries (vmlib \${LLVM_AVAILABLE_LIBS} \${UV_A_LIBS} -lm -ldl -lpthread)
`);
  const run=args=>spawnSync('cmake',args,{encoding:'utf8'});
  const configure=(directory,...flags)=>run(['-S',source,'-B',directory,...flags]);
  const build=directory=>run(['--build',directory,'--target','vmlib','-j','1']);
  const target=join(root,'shared');assert.equal(configure(target).status,0);
  const red=build(target);assert.notEqual(red.status,0);assert.match(red.stdout+red.stderr,/missing-gpu/);
  const patch=await configureWamrLLVMSharedLink(root,'wamr-llvm-jit');assert.ok(patch?.sha256);
  assert.equal(configure(target).status,0);const green=build(target);assert.equal(green.status,0,green.stdout+green.stderr);
  assert.equal((await configureWamrLLVMSharedLink(root,'wamr-llvm-jit')).sha256,patch.sha256);
  const staticTarget=join(root,'static');assert.equal(configure(staticTarget,'-DLLVM_LINK_LLVM_DYLIB=OFF').status,0);
  assert.notEqual(build(staticTarget).status,0,'static packages must still supply their declared libraries');
 }finally{await rm(root,{recursive:true,force:true})}
});
