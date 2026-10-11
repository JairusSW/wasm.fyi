// Zwasm C API execution qualification. Force and verify each selected backend.
#include "embedding.h"
#include <wasm.h>
#include <zwasm.h>
#include <cstdlib>
#include <memory>
#include <dlfcn.h>
#include <chrono>

static std::runtime_error last_error(const char* phase){return std::runtime_error(std::string("Zwasm C API failure: ")+phase);}
static std::runtime_error trap_error(wasm_trap_t* trap) {
    wasm_message_t message;wasm_trap_message(trap,&message);
    std::string text(message.data,message.size);
    wasm_byte_vec_delete(&message);wasm_trap_delete(trap);
    return std::runtime_error("guest trap: "+text);
}
struct Engine {
    wasm_engine_t* engine=nullptr;wasm_store_t* store=nullptr;
    ~Engine(){if(store)wasm_store_delete(store);if(engine)wasm_engine_delete(engine);}
};
struct Instance {
    wasm_store_t* store=nullptr;
    wasm_instance_t* instance=nullptr;
    wasm_extern_vec_t exports=WASM_EMPTY_VEC;
    std::vector<std::string> names;
    ~Instance(){wasm_extern_vec_delete(&exports);if(instance)wasm_instance_delete(instance);}
};
static wasm_extern_t* lookup(Instance* i,const char* name) {
    for(size_t k=0;k<i->names.size();k++)if(i->names[k]==name)return i->exports.data[k];
    throw std::runtime_error("missing export: "+std::string(name));
}
static wasm_func_t* function(Instance* i,const char* name) {
    auto f=wasm_extern_as_func(lookup(i,name));if(!f)throw std::runtime_error("export is not a function");return f;
}
static uint8_t kind(const wasm_valtype_t* t) {
    auto k=wasm_valtype_kind(t);return k==WASM_I32?0x7f:k==WASM_I64?0x7e:k==WASM_F32?0x7d:k==WASM_F64?0x7c:0;
}
static wasm_val_t argument(uint8_t type,uint64_t bits){
    wasm_val_t value{};
    if(type==0x7f){value.kind=WASM_I32;value.of.i32=static_cast<int32_t>(bits);}
    else if(type==0x7e){value.kind=WASM_I64;value.of.i64=static_cast<int64_t>(bits);}
    else if(type==0x7d){value.kind=WASM_F32;const uint32_t low=static_cast<uint32_t>(bits);std::memcpy(&value.of.f32,&low,sizeof(low));}
    else if(type==0x7c){value.kind=WASM_F64;std::memcpy(&value.of.f64,&bits,sizeof(bits));}
    else throw std::runtime_error("unsupported: nonnumeric parameter");
    return value;
}
static uint64_t result_bits(const wasm_val_t& value){
    if(value.kind==WASM_I32)return static_cast<uint32_t>(value.of.i32);
    if(value.kind==WASM_I64)return static_cast<uint64_t>(value.of.i64);
    if(value.kind==WASM_F32){uint32_t bits;std::memcpy(&bits,&value.of.f32,sizeof(bits));return bits;}
    if(value.kind==WASM_F64){uint64_t bits;std::memcpy(&bits,&value.of.f64,sizeof(bits));return bits;}
    throw std::runtime_error("unsupported: nonnumeric result");
}
static wasm_trap_t* assemblyscript_abort(void* env,const wasm_val_vec_t*,wasm_val_vec_t*) {
    static const char text[]="AssemblyScript abort";
    const wasm_message_t message={sizeof(text)-1,const_cast<char*>(text)};
    auto trap=wasm_trap_new(static_cast<wasm_store_t*>(env),&message);
    if(!trap)std::abort();
    return trap;
}
static wasm_trap_t* identity(void*,const wasm_val_vec_t* args,wasm_val_vec_t* results) {
    if(args->size!=1||results->size!=1||args->data[0].kind!=WASM_I32)return nullptr;
    results->data[0].kind=WASM_I32;results->data[0].of.i32=args->data[0].of.i32;return nullptr;
}
extern "C" {
bool wasmfyi_zwasm_native_code_size(const wasm_instance_t*,size_t*);
const char* wasmfyi_zwasm_compile_module(wasm_module_t*);
const char* wb_error(){return wb_last_error.c_str();}
const char* wb_version(){return "b84f9f97654819b83189d385092726b3dadb1251";}
void* wb_engine_new(){WB_TRY{
 auto e=std::make_unique<Engine>();e->engine=wasm_engine_new();if(!e->engine)throw last_error("engine");e->store=wasm_store_new(e->engine);if(!e->store)throw last_error("store");return e.release();
}WB_CATCH(nullptr)}
void wb_engine_delete(void* e){delete static_cast<Engine*>(e);}
void* wb_module_new(void* value,const uint8_t* bytes,size_t size){WB_TRY{
    auto e=static_cast<Engine*>(value);
    wasm_store_t* store=e->store;
    if(!store)throw last_error("compilation store");
    const wasm_byte_vec_t binary={size,const_cast<char*>(reinterpret_cast<const char*>(bytes))};
    auto m=wasm_module_new(store,&binary);if(!m)throw last_error("compile");
    if(!std::getenv("ZWASM_INTERPRETER"))if(const char* problem=wasmfyi_zwasm_compile_module(m)){
        wasm_module_delete(m);
        // An explicit SDK opcode capability failure is not an adapter error.
        // Preserve all other compilation errors rather than masking them.
        const char* prefix=std::strcmp(problem,"UnsupportedOp")==0?"unsupported: Zwasm JIT compile: ":"Zwasm JIT compile: ";
        throw std::runtime_error(std::string(prefix)+problem);
    }
    return m;
}WB_CATCH(nullptr)}
void wb_module_delete(void* m){wasm_module_delete(static_cast<wasm_module_t*>(m));}
void* wb_instance_new(void* value,void* module){WB_TRY{
    auto e=static_cast<Engine*>(value);auto m=static_cast<wasm_module_t*>(module);auto i=std::make_unique<Instance>();
    i->store=e->store;if(!i->store)throw last_error("instance store");
    wasm_importtype_vec_t imported;wasm_module_imports(m,&imported);
    std::unique_ptr<wasm_importtype_vec_t,decltype(&wasm_importtype_vec_delete)> imported_owner(&imported,wasm_importtype_vec_delete);
    std::vector<std::unique_ptr<wasm_func_t,decltype(&wasm_func_delete)>> functions;
    std::vector<wasm_extern_t*> values;
    for(size_t k=0;k<imported.size;k++){
        const auto name=wasm_importtype_name(imported.data[k]),space=wasm_importtype_module(imported.data[k]);
        const std::string moduleName(space->data,space->size),fieldName(name->data,name->size);
        const auto type=wasm_externtype_as_functype_const(wasm_importtype_type(imported.data[k]));
        if(!type)throw std::runtime_error("unsupported: host imports must be functions");
        const auto params=wasm_functype_params(type),results=wasm_functype_results(type);
        if(moduleName=="wasmbench" && fieldName=="identity") {
            if(params->size!=1||results->size!=1||wasm_valtype_kind(params->data[0])!=WASM_I32||wasm_valtype_kind(results->data[0])!=WASM_I32)throw std::runtime_error("unsupported: wasmbench.identity requires (i32)->i32");
            // Wasmer rejects a null callback environment; the identity callback
            // ignores its environment, so retain the owning store as a valid token.
            auto f=wasm_func_new_with_env(i->store,type,identity,i->store,nullptr);
            if(!f)throw last_error("identity callback");functions.emplace_back(f,wasm_func_delete);values.push_back(wasm_func_as_extern(f));continue;
        }
        if(moduleName!="env" || fieldName!="abort")throw std::runtime_error("unsupported: unknown host import");
        if(params->size!=4 || results->size!=0)throw std::runtime_error("unsupported: env.abort signature mismatch");
        for(size_t n=0;n<params->size;n++)if(wasm_valtype_kind(params->data[n])!=WASM_I32)throw std::runtime_error("unsupported: env.abort requires four i32 parameters");
        auto f=wasm_func_new_with_env(i->store,type,assemblyscript_abort,i->store,nullptr);
        if(!f)throw last_error("abort callback");functions.emplace_back(f,wasm_func_delete);values.push_back(wasm_func_as_extern(f));
    }
    wasm_extern_vec_t imports={values.size(),values.data()};wasm_trap_t* trap=nullptr;
    i->instance=zwasm_instance_new_ex(i->store,m,&imports,&trap,std::getenv("ZWASM_INTERPRETER")?ZWASM_ENGINE_INTERP:ZWASM_ENGINE_JIT);
    if(trap)throw trap_error(trap);if(!i->instance)throw last_error("instantiate");
    int32_t resolved=0;if(!zwasm_instance_engine(i->instance,&resolved)||resolved!=(std::getenv("ZWASM_INTERPRETER")?ZWASM_ENGINE_INTERP:ZWASM_ENGINE_JIT))throw std::runtime_error("resolved Zwasm backend differs from requested backend");
    wasm_instance_exports(i->instance,&i->exports);
    wasm_exporttype_vec_t types;wasm_module_exports(m,&types);
    for(size_t k=0;k<types.size;k++){const auto name=wasm_exporttype_name(types.data[k]);i->names.emplace_back(name->data,name->size);}
    wasm_exporttype_vec_delete(&types);
    if(i->names.size()!=i->exports.size)throw std::runtime_error("export metadata mismatch");return i.release();
}WB_CATCH(nullptr)}
void wb_instance_delete(void* i){delete static_cast<Instance*>(i);}
int wb_native_size(void* value,size_t* out){
    return wasmfyi_zwasm_native_code_size(static_cast<Instance*>(value)->instance,out)?0:-1;
}
int wb_signature(void* value,const char* name,uint8_t* params,size_t* np,uint8_t* results,size_t* nr){WB_TRY{
    std::unique_ptr<wasm_functype_t,decltype(&wasm_functype_delete)> t(wasm_func_type(function(static_cast<Instance*>(value),name)),wasm_functype_delete);
    if(!t)throw last_error("export function type");
    const auto p=wasm_functype_params(t.get()),r=wasm_functype_results(t.get());
    if(p->size>*np||r->size>*nr)throw std::runtime_error("unsupported: signature exceeds 32 values");
    *np=p->size;*nr=r->size;for(size_t k=0;k<*np;k++)params[k]=kind(p->data[k]);for(size_t k=0;k<*nr;k++)results[k]=kind(r->data[k]);return 0;
}WB_CATCH(-1)}
int wb_call(void* value,const char* name,const uint64_t* args,size_t na,uint64_t* out,size_t nr){WB_TRY{
    auto f=function(static_cast<Instance*>(value),name);
    std::unique_ptr<wasm_functype_t,decltype(&wasm_functype_delete)> t(wasm_func_type(f),wasm_functype_delete);
    if(!t)throw last_error("export function type");
    const auto p=wasm_functype_params(t.get()),r=wasm_functype_results(t.get());
    if(na!=p->size||nr!=r->size)throw std::runtime_error("signature arity mismatch");
    std::vector<wasm_val_t> params(na),results(nr);
    for(size_t k=0;k<na;k++)params[k]=argument(kind(p->data[k]),args[k]);
    wasm_val_vec_t pv={na,params.data()},rv={nr,results.data()};auto trap=wasm_func_call(f,&pv,&rv);if(trap)throw trap_error(trap);
    for(size_t k=0;k<nr;k++)out[k]=result_bits(results[k]);return 0;
}WB_CATCH(-1)}
int wb_call_batch(void* value,const char* name,const uint64_t* args,size_t na,uint64_t* out,size_t nr,size_t operations,uint64_t* elapsed){WB_TRY{
    if(!operations||operations>1000000||!elapsed)throw std::runtime_error("invalid bounded batch");
    auto f=function(static_cast<Instance*>(value),name);
    std::unique_ptr<wasm_functype_t,decltype(&wasm_functype_delete)> type(wasm_func_type(f),wasm_functype_delete);
    if(!type)throw last_error("export function type");
    const auto p=wasm_functype_params(type.get()),r=wasm_functype_results(type.get());
    if(na!=p->size||nr!=r->size)throw std::runtime_error("signature arity mismatch");
    std::vector<wasm_val_t> params(na),results(nr);
    for(size_t k=0;k<na;k++)params[k]=argument(kind(p->data[k]),args[k]);
    wasm_val_vec_t pv={na,params.data()},rv={nr,results.data()};
    const auto start=std::chrono::steady_clock::now();
    for(size_t operation=0;operation<operations;operation++)if(auto trap=wasm_func_call(f,&pv,&rv))throw trap_error(trap);
    *elapsed=std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now()-start).count();
    for(size_t k=0;k<nr;k++)out[k]=result_bits(results[k]);
    return 0;
}WB_CATCH(-1)}
int wb_call_verified_batch(void* value,const char* name,const uint64_t* args,size_t na,uint64_t* out,size_t nr,size_t operations,const uint64_t* expected,const char* pointer_export,const uint64_t* offsets,const size_t* lengths,const uint8_t* const* bytes,size_t checks,uint64_t* elapsed){WB_TRY{
    if(!operations||operations>1000000||!elapsed||!checks)throw std::runtime_error("invalid verified bounded batch");
    auto instance=static_cast<Instance*>(value);
    auto f=function(instance,name);
    std::unique_ptr<wasm_functype_t,decltype(&wasm_functype_delete)> type(wasm_func_type(f),wasm_functype_delete);
    if(!type)throw last_error("export function type");
    const auto p=wasm_functype_params(type.get()),r=wasm_functype_results(type.get());
    if(na!=p->size||nr!=r->size)throw std::runtime_error("signature arity mismatch");
    std::vector<wasm_val_t> params(na),results(nr);
    for(size_t k=0;k<na;k++)params[k]=argument(kind(p->data[k]),args[k]);
    wasm_val_vec_t pv={na,params.data()},rv={nr,results.data()};
    wasm_func_t* pointer=nullptr;
    if(pointer_export&&*pointer_export){
        pointer=function(instance,pointer_export);
        std::unique_ptr<wasm_functype_t,decltype(&wasm_functype_delete)> pt(wasm_func_type(pointer),wasm_functype_delete);
        if(!pt||wasm_functype_params(pt.get())->size!=0||wasm_functype_results(pt.get())->size!=1)throw std::runtime_error("output pointer export signature mismatch");
        auto pk=wasm_valtype_kind(wasm_functype_results(pt.get())->data[0]);
        if(pk!=WASM_I32&&pk!=WASM_I64)throw std::runtime_error("output pointer export must return an integer");
    }
    auto memory=wasm_extern_as_memory(lookup(instance,"memory"));
    if(!memory)throw std::runtime_error("export is not a memory");
    uint64_t duration=0;
    for(size_t operation=0;operation<operations;operation++){
        const auto start=std::chrono::steady_clock::now();
        auto trap=wasm_func_call(f,&pv,&rv);
        const auto stop=std::chrono::steady_clock::now();
        if(trap)throw trap_error(trap);
        duration+=std::chrono::duration_cast<std::chrono::nanoseconds>(stop-start).count();
        // Verify every invocation, after its timer, without Python/ctypes work.
        for(size_t k=0;k<nr;k++){
            out[k]=result_bits(results[k]);
            if(out[k]!=expected[k])throw std::runtime_error("scalar oracle mismatch");
        }
        uint64_t base=0;
        if(pointer){
            wasm_val_t result{};wasm_val_vec_t empty={0,nullptr},returned={1,&result};
            if(auto problem=wasm_func_call(pointer,&empty,&returned))throw trap_error(problem);
            base=result_bits(result);
        }
        // Guest code may grow memory or change its output pointer each time.
        auto count=wasm_memory_data_size(memory);
        auto data=reinterpret_cast<const uint8_t*>(wasm_memory_data(memory));
        for(size_t k=0;k<checks;k++){
            if(base>count||offsets[k]>count-base||lengths[k]>count-base-offsets[k])throw std::runtime_error("memory oracle/input outside bounds");
            if(lengths[k]&&std::memcmp(data+base+offsets[k],bytes[k],lengths[k]))throw std::runtime_error("memory oracle mismatch");
        }
    }
    *elapsed=duration;return 0;
}WB_CATCH(-1)}
uint8_t* wb_memory(void* value,size_t* n){WB_TRY{
    auto m=wasm_extern_as_memory(lookup(static_cast<Instance*>(value),"memory"));if(!m)throw std::runtime_error("export is not a memory");
    *n=wasm_memory_data_size(m);return reinterpret_cast<uint8_t*>(wasm_memory_data(m));
}WB_CATCH(nullptr)}
}
