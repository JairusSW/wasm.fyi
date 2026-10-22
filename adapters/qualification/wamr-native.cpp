// Native WAMR embedding for numeric probes whose other exports contain GC refs.
// The C API eagerly wraps every export and cannot represent these signatures.
#include "embedding.h"
#include <wasm_export.h>
#include <memory>
#include <limits>
#include <cstdlib>

struct Engine {
    RunningMode mode=Mode_Interp;
    Engine(){
        RuntimeInitArgs args{};
        args.mem_alloc_type=Alloc_With_System_Allocator;
        args.gc_heap_size=16*1024*1024;
        const char* selected=getenv("WASMBENCH_WAMR_RUNNING_MODE");
        if(selected&&strcmp(selected,"llvm-jit")!=0&&strcmp(selected,"interp")!=0&&strcmp(selected,"interpreter")!=0)throw std::runtime_error("unsupported: native GC embedding backend");
        mode=selected&&strcmp(selected,"llvm-jit")==0?Mode_LLVM_JIT:Mode_Interp;
        args.running_mode=mode;
        if(!wasm_runtime_full_init(&args))throw std::runtime_error("native WAMR initialization failed");
        if(!wasm_runtime_is_running_mode_supported(mode)){wasm_runtime_destroy();throw std::runtime_error("requested native WAMR backend is unavailable");}
    }
    ~Engine(){wasm_runtime_destroy();}
};
struct Module {
    // WAMR retains and may modify its input buffer until module unload.
    std::vector<uint8_t> bytes;
    wasm_module_t value=nullptr;
    ~Module(){if(value)wasm_runtime_unload(value);}
};
struct Instance {
    wasm_module_inst_t value=nullptr;
    wasm_exec_env_t env=nullptr;
    ~Instance(){if(env)wasm_runtime_destroy_exec_env(env);if(value)wasm_runtime_deinstantiate(value);}
};
static wasm_function_inst_t function(Instance* i,const char* name){
    auto f=wasm_runtime_lookup_function(i->value,name);
    if(!f)throw std::runtime_error(std::string("missing numeric export: ")+name);
    return f;
}
static uint8_t type(wasm_valkind_t kind){
    switch(kind){case WASM_I32:return 0x7f;case WASM_I64:return 0x7e;default:throw std::runtime_error("unsupported: native WAMR numeric probe requires integer signature");}
}
extern "C" {
const char* wb_error(){return wb_last_error.c_str();}
const char* wb_version(){return WB_VERSION;}
void* wb_engine_new(){WB_TRY{return new Engine();}WB_CATCH(nullptr)}
void wb_engine_delete(void* e){delete static_cast<Engine*>(e);}
void* wb_module_new(void*,const uint8_t* bytes,size_t n){WB_TRY{
    if(n>std::numeric_limits<uint32_t>::max())throw std::runtime_error("module too large");
    auto m=std::make_unique<Module>();m->bytes.assign(bytes,bytes+n);char error[512]{};
    m->value=wasm_runtime_load(m->bytes.data(),static_cast<uint32_t>(n),error,sizeof(error));
    if(!m->value)throw std::runtime_error(error);
    return m.release();
}WB_CATCH(nullptr)}
void wb_module_delete(void* m){delete static_cast<Module*>(m);}
void* wb_instance_new(void* engine,void* m){WB_TRY{
    auto i=std::make_unique<Instance>();char error[512]{};
    i->value=wasm_runtime_instantiate(static_cast<Module*>(m)->value,1<<20,0,error,sizeof(error));
    if(!i->value)throw std::runtime_error(error);
    if(wasm_runtime_get_running_mode(i->value)!=static_cast<Engine*>(engine)->mode)throw std::runtime_error("native WAMR backend selection mismatch");
    i->env=wasm_runtime_create_exec_env(i->value,1<<20);
    if(!i->env)throw std::runtime_error("native execution environment allocation failed");
    return i.release();
}WB_CATCH(nullptr)}
void wb_instance_delete(void* i){delete static_cast<Instance*>(i);}
int wb_signature(void* ptr,const char* name,uint8_t* params,size_t* np,uint8_t* results,size_t* nr){WB_TRY{
    auto i=static_cast<Instance*>(ptr);auto f=function(i,name);
    size_t pc=wasm_func_get_param_count(f,i->value),rc=wasm_func_get_result_count(f,i->value);
    if(pc>*np||rc>*nr)throw std::runtime_error("signature capacity exceeded");
    std::vector<wasm_valkind_t> p(pc),r(rc);
    wasm_func_get_param_types(f,i->value,p.data());wasm_func_get_result_types(f,i->value,r.data());
    for(size_t k=0;k<pc;k++)params[k]=type(p[k]);for(size_t k=0;k<rc;k++)results[k]=type(r[k]);
    *np=pc;*nr=rc;return 0;
}WB_CATCH(-1)}
int wb_call(void* ptr,const char* name,const uint64_t* args,size_t na,uint64_t* out,size_t nr){WB_TRY{
    uint8_t pt[32],rt[32];size_t pc=32,rc=32;
    if(wb_signature(ptr,name,pt,&pc,rt,&rc))throw std::runtime_error(wb_last_error);
    if(pc!=na||rc!=nr)throw std::runtime_error("signature arity mismatch");
    auto i=static_cast<Instance*>(ptr);auto f=function(i,name);std::vector<uint32_t> cells(64);uint32_t count=0;
    for(size_t k=0;k<na;k++){cells[count++]=static_cast<uint32_t>(args[k]);if(pt[k]==0x7e)cells[count++]=static_cast<uint32_t>(args[k]>>32);}
    if(!wasm_runtime_call_wasm(i->env,f,count,cells.data())){const char* error=wasm_runtime_get_exception(i->value);throw std::runtime_error(error?error:"native WAMR call failed");}
    size_t at=0;for(size_t k=0;k<nr;k++){out[k]=cells[at++];if(rt[k]==0x7e)out[k]|=static_cast<uint64_t>(cells[at++])<<32;}
    return 0;
}WB_CATCH(-1)}
uint8_t* wb_memory(void*,size_t*){wb_last_error="unsupported: native GC probe embedding does not expose linear memory";return nullptr;}
}
