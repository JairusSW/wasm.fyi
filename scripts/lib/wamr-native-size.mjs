import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
// Optional native-size instrumentation is enabled only for the separate inspect
// pass. Timed compilations do not parse native objects or record code extents.
export async function instrumentWamrNativeSize(source,configuration) {
 if(configuration==='wamr')return null;
 const files={};
 async function patch(path,anchor,replacement) {
  const file=join(source,path);let text=await readFile(file,'utf8');
  if(!text.includes('wasmfyi_native_size')){if(!text.includes(anchor))throw Error('Pinned WAMR native-size seam changed: '+path);text=text.replace(anchor,replacement);await writeFile(file,text);}
  files[path]=digest(Buffer.from(text));
 }
 const common='core/iwasm/common/wasm_c_api.c';
 const getter=`
/* wasmfyi_native_size: enabled only for the diagnostic compile. */
bool wasmfyi_native_size_capture_enabled = false;
void wasmbench_wamr_native_size_capture(bool enable) {
    __atomic_store_n(&wasmfyi_native_size_capture_enabled, enable, __ATOMIC_RELAXED);
}
bool wasmbench_wamr_module_native_size(const wasm_module_t *module, uint64 *size) {
    if (!module || !size || (*module)->module_type != Wasm_Module_Bytecode) return false;
    WASMModule *m = (WASMModule *)module_to_module_ext((wasm_module_t *)module)->module_comm_rt;
    uint64 total = 0;
#if WASM_ENABLE_FAST_JIT != 0
    for (uint32 i=0;i<m->function_count;i++) {
        WASMFunction *f=m->functions[i];
        if (!f->fast_jit_jitted_code || !f->wasmfyi_native_size_bytes) return false;
        if (UINT64_MAX-total < f->wasmfyi_native_size_bytes) return false;
        total += f->wasmfyi_native_size_bytes;
    }
#elif WASM_ENABLE_JIT != 0 && WASM_ENABLE_LAZY_JIT == 0
    if (!m->comp_ctx || m->comp_ctx->wasmfyi_native_size_invalid) return false;
    for (uint32 i=0;i<m->function_count;i++) if (!m->func_ptrs_compiled[i]) return false;
    total=__atomic_load_n(&m->comp_ctx->wasmfyi_native_size_bytes,__ATOMIC_RELAXED);
    if (m->function_count && !total) return false;
#else
    return false;
#endif
    *size=total; return true;
}
`;
 const file=join(source,common);let text=await readFile(file,'utf8');if(!text.includes('wasmfyi_native_size_capture_enabled')){text+=getter;await writeFile(file,text);}files[common]=digest(Buffer.from(text));
 if(configuration==='wamr-fast-jit') {
  await patch('core/iwasm/interpreter/wasm.h','    void *fast_jit_jitted_code;','    void *fast_jit_jitted_code;\n    uint64 wasmfyi_native_size_bytes;');
  await patch('core/iwasm/fast-jit/jit_codecache.c','    module->fast_jit_func_ptrs[jit_func_idx] = func->fast_jit_jitted_code =',`    /* wasmfyi_native_size: exact emitted function block, not cache capacity. */
    extern bool wasmfyi_native_size_capture_enabled;
    if (__atomic_load_n(&wasmfyi_native_size_capture_enabled,__ATOMIC_RELAXED))
        func->wasmfyi_native_size_bytes=(uint64)((uint8 *)cc->jitted_addr_end-(uint8 *)cc->jitted_addr_begin);
    module->fast_jit_func_ptrs[jit_func_idx] = func->fast_jit_jitted_code =`);
 } else if(configuration==='wamr-llvm-jit') {
  await patch('core/iwasm/compilation/aot_llvm.h','    LLVMOrcLLLazyJITRef orc_jit;','    LLVMOrcLLLazyJITRef orc_jit;\n    uint64 wasmfyi_native_size_bytes;\n    uint32 wasmfyi_native_size_invalid;');
  await patch('core/iwasm/compilation/aot_llvm.c','    comp_ctx->orc_jit = orc_jit;',`    /* wasmfyi_native_size: observe actual emitted executable sections. */
    extern bool wasmfyi_native_size_capture_enabled;
    extern void wasmbench_wamr_install_native_size_probe(LLVMOrcLLLazyJITRef,uint64 *,uint32 *);
    if (__atomic_load_n(&wasmfyi_native_size_capture_enabled,__ATOMIC_RELAXED))
        wasmbench_wamr_install_native_size_probe(orc_jit,&comp_ctx->wasmfyi_native_size_bytes,&comp_ctx->wasmfyi_native_size_invalid);
    comp_ctx->orc_jit = orc_jit;`);
  const path='core/iwasm/compilation/aot_orc_extra.cpp',full=join(source,path);let cpp=await readFile(full,'utf8');
  if(!cpp.includes('wasmbench_wamr_install_native_size_probe')) {
   cpp+=`
// wasmfyi_native_size: inspect-only observer; preserves the original object.
#include "llvm/Object/ObjectFile.h"
extern "C" void wasmbench_wamr_install_native_size_probe(LLVMOrcLLLazyJITRef jit,uint64 *size,uint32 *invalid) {
    unwrap(jit)->getObjTransformLayer().setTransform([size,invalid](std::unique_ptr<MemoryBuffer> buffer)->Expected<std::unique_ptr<MemoryBuffer>> {
        auto object=llvm::object::ObjectFile::createObjectFile(buffer->getMemBufferRef());
        if (!object) { consumeError(object.takeError()); __atomic_store_n(invalid,1,__ATOMIC_RELAXED); return std::move(buffer); }
        for (const auto &section : (*object)->sections()) if (section.isText())
            __atomic_fetch_add(size,section.getSize(),__ATOMIC_RELAXED);
        return std::move(buffer);
    });
}
`;await writeFile(full,cpp);
  }files[path]=digest(Buffer.from(cpp));
 }
 return {policy:configuration==='wamr-fast-jit'?'Exact emitted function blocks; complete defined-function coverage':'LLVM native executable text sections; complete eager function compilation; excludes ORC stubs and non-executable metadata',capture:'Separate inspect pass only',files,patchSha256:digest(Buffer.from(JSON.stringify(files)))};
}
