import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';
import {instrumentWamrNativeSize} from './lib/wamr-native-size.mjs';
test('instruments exact Fast JIT extents and LLVM text sections idempotently',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wamr-size-'));
 try {
  const fixtures={'core/iwasm/common/wasm_c_api.c':'original C API\n','core/iwasm/interpreter/wasm.h':'    void *fast_jit_jitted_code;\n','core/iwasm/fast-jit/jit_codecache.c':'    module->fast_jit_func_ptrs[jit_func_idx] = func->fast_jit_jitted_code =\n','core/iwasm/compilation/aot_llvm.h':'    LLVMOrcLLLazyJITRef orc_jit;\n','core/iwasm/compilation/aot_llvm.c':'    comp_ctx->orc_jit = orc_jit;\n','core/iwasm/compilation/aot_orc_extra.cpp':'original ORC wrappers\n'};
  for(const [path,text] of Object.entries(fixtures)){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),text)}
  assert.equal(await instrumentWamrNativeSize(root,'wamr'),null);
  const fast=await instrumentWamrNativeSize(root,'wamr-fast-jit');assert.deepEqual(await instrumentWamrNativeSize(root,'wamr-fast-jit'),fast);
  const llvm=await instrumentWamrNativeSize(root,'wamr-llvm-jit');assert.deepEqual(await instrumentWamrNativeSize(root,'wamr-llvm-jit'),llvm);
  const code=await readFile(join(root,'core/iwasm/compilation/aot_orc_extra.cpp'),'utf8');assert.match(code,/section\.isText\(\)/);assert.match(code,/return std::move\(buffer\)/);
  const init=await readFile(join(root,'core/iwasm/compilation/aot_llvm.c'),'utf8');assert.match(init,/if \(__atomic_load_n\(&wasmfyi_native_size_capture_enabled/);
  const registration=await readFile(join(root,'core/iwasm/fast-jit/jit_codecache.c'),'utf8');assert.match(registration,/jitted_addr_end-\(uint8 \*\)cc->jitted_addr_begin/);
 }finally{await rm(root,{recursive:true,force:true})}
});
