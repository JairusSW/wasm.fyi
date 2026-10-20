// Original MIT corpus using the portable wasm.h C API. wasmtime.h is used only
// to turn the source fixture into bytes; no Wasmtime-specific invocation API.
#include <wasm.h>
#include <wasmtime.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(x) do { if (!(x)) { fprintf(stderr,"check failed at line %d: %s\n",__LINE__,#x); exit(1); } } while(0)
static wasm_trap_t *step(const wasm_val_vec_t *args, wasm_val_vec_t *results) {
  results->data[0].kind=WASM_I32;
  results->data[0].of.i32=args->data[0].of.i32*3+1;
  return NULL;
}
int main(int argc,char **argv) {
  CHECK(argc==3);
  const char *name=argv[1];
  char *end=NULL; unsigned long count=strtoul(argv[2],&end,10);
  CHECK(end&&!*end&&count<=100000000);
  const char *wat="(module (import \"host\" \"step\" (func $step (param i32) (result i32)))"
    "(func (export \"direct\") (param i32) (result i32) local.get 0 i32.const 3 i32.mul i32.const 1 i32.add)"
    "(func (export \"callback\") (param i32) (result i32) local.get 0 call $step)"
    "(global (export \"global\") (mut i32) (i32.const 0))"
    "(memory (export \"memory\") 1 2)"
    "(table (export \"table\") 1 1 funcref)"
    "(func (export \"read\") (param i32) (result i32) local.get 0 i32.load8_u)"
    "(func (export \"trap\") (param i32) (result i32) unreachable))";
  wasm_byte_vec_t binary;
  wasmtime_error_t *error=wasmtime_wat2wasm(wat,strlen(wat),&binary);
  CHECK(!error);
  wasm_engine_t *engine=wasm_engine_new(); CHECK(engine);
  wasm_store_t *store=wasm_store_new(engine); CHECK(store);
  wasm_module_t *module=wasm_module_new(store,&binary); CHECK(module);
  wasm_byte_vec_delete(&binary);
  wasm_functype_t *type=wasm_functype_new_1_1(wasm_valtype_new_i32(),wasm_valtype_new_i32());
  wasm_func_t *host=wasm_func_new(store,type,step); CHECK(host);
  wasm_functype_delete(type);
  wasm_extern_t *imports_data[]={wasm_func_as_extern(host)};
  wasm_extern_vec_t imports={1,imports_data};
  wasm_trap_t *trap=NULL;
  wasm_instance_t *instance=wasm_instance_new(store,module,&imports,&trap); CHECK(instance&&!trap);
  wasm_extern_vec_t exports; wasm_instance_exports(instance,&exports); CHECK(exports.size==7);
  wasm_func_t *direct=wasm_extern_as_func(exports.data[0]);
  wasm_func_t *callback=wasm_extern_as_func(exports.data[1]);
  wasm_global_t *global=wasm_extern_as_global(exports.data[2]);
  wasm_memory_t *memory=wasm_extern_as_memory(exports.data[3]);
  wasm_table_t *table=wasm_extern_as_table(exports.data[4]);
  wasm_func_t *read=wasm_extern_as_func(exports.data[5]);
  wasm_func_t *trapping=wasm_extern_as_func(exports.data[6]);
  CHECK(direct&&callback&&global&&memory&&table&&read&&trapping);
  CHECK(wasm_memory_data_size(memory)==65536&&wasm_table_size(table)==1);
  uint32_t checksum=0,expected=0;
  for(unsigned long i=0;i<count;i++) {
    int32_t input=(int32_t)(i&255);
    wasm_val_t arg=WASM_I32_VAL(input),value=WASM_I32_VAL(0);
    wasm_val_vec_t args={1,&arg},results={1,&value};
    if(!strcmp(name,"direct-call")||!strcmp(name,"host-callback")) {
      CHECK(!wasm_func_call(!strcmp(name,"direct-call")?direct:callback,&args,&results));
      expected+=3*(uint32_t)input+1;
    } else if(!strcmp(name,"mutable-global")) {
      wasm_global_set(global,&arg);wasm_global_get(global,&value);expected+=(uint32_t)input;
    } else if(!strcmp(name,"memory-access")) {
      wasm_memory_data(memory)[17]=(wasm_byte_t)input;
      arg.of.i32=17;CHECK(!wasm_func_call(read,&args,&results));expected+=(uint32_t)input;
    } else if(!strcmp(name,"table-call")) {
      CHECK(wasm_table_set(table,0,wasm_func_as_ref(direct)));
      wasm_ref_t *ref=wasm_table_get(table,0); CHECK(ref);
      CHECK(!wasm_func_call(wasm_ref_as_func(ref),&args,&results));
      wasm_ref_delete(ref);expected+=3*(uint32_t)input+1;
    } else if(!strcmp(name,"trap-lifecycle")) {
      trap=wasm_func_call(trapping,&args,&results);CHECK(trap);
      wasm_message_t message;wasm_trap_message(trap,&message);CHECK(message.size>0);
      wasm_byte_vec_delete(&message);wasm_trap_delete(trap);value.of.i32=1;expected++;
    } else CHECK(0);
    CHECK(value.kind==WASM_I32);checksum+=(uint32_t)value.of.i32;
  }
  CHECK(checksum==expected);
  printf("{\"case\":\"%s\",\"operations\":%lu,\"checksum\":%u}\n",name,count,checksum);
  wasm_extern_vec_delete(&exports);wasm_instance_delete(instance);wasm_func_delete(host);
  wasm_module_delete(module);wasm_store_delete(store);wasm_engine_delete(engine);
  return 0;
}
