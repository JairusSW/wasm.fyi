/* Native SDK correctness preflight, not a performance benchmark. */
#include <wasmer.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failure(const char *phase) {
  int length = wasmer_last_error_length();
  if (length > 0 && length < 1024 * 1024) {
    char *message = calloc((size_t)length + 1, 1);
    if (message) { wasmer_last_error_message(message, length); fprintf(stderr, "%s: %s\n", phase, message); free(message); }
  }
  printf("{\"status\":\"failed\",\"phase\":\"%s\"}\n", phase);
  return 1;
}

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  wasmer_backend_t backend;
  if (!strcmp(argv[1], "llvm")) backend = LLVM;
  else if (!strcmp(argv[1], "singlepass")) backend = SINGLEPASS;
  else return 2;
  if (!wasmer_is_backend_available(backend)) {
    puts("{\"status\":\"unavailable\",\"reason\":\"SDK backend is not compiled in\"}");
    return 0;
  }
  FILE *file = fopen(argv[2], "rb");
  if (!file || fseek(file, 0, SEEK_END)) return 2;
  long size = ftell(file);
  if (size <= 0 || size > 1024 * 1024 || fseek(file, 0, SEEK_SET)) return 2;
  wasm_byte_vec_t bytes;
  wasm_byte_vec_new_uninitialized(&bytes, (size_t)size);
  if (!bytes.data || fread(bytes.data, 1, bytes.size, file) != bytes.size) return 2;
  fclose(file);
  wasm_config_t *config = wasm_config_new();
  wasm_config_set_backend(config, backend);
  wasm_engine_t *engine = wasm_engine_new_with_config(config);
  if (!engine) return failure("engine");
  wasm_store_t *store = wasm_store_new(engine);
  if (!store) return failure("store");
  wasm_module_t *module = wasm_module_new(store, &bytes);
  wasm_byte_vec_delete(&bytes);
  if (!module) return failure("compile");
  wasm_extern_vec_t imports = WASM_EMPTY_VEC;
  wasm_trap_t *trap = NULL;
  wasm_instance_t *instance = wasm_instance_new(store, module, &imports, &trap);
  if (!instance || trap) return failure("instantiate");
  wasm_exporttype_vec_t types;
  wasm_module_exports(module, &types);
  wasm_extern_vec_t exports;
  wasm_instance_exports(instance, &exports);
  wasm_func_t *function = NULL;
  for (size_t index = 0; index < types.size && index < exports.size; index++) {
    const wasm_name_t *name = wasm_exporttype_name(types.data[index]);
    if (name->size == 9 && !memcmp(name->data, "benchmark", 9)) function = wasm_extern_as_func(exports.data[index]);
  }
  if (!function) return failure("export");
  wasm_functype_t *type = wasm_func_type(function);
  const wasm_valtype_vec_t *params = wasm_functype_params(type);
  const wasm_valtype_vec_t *results = wasm_functype_results(type);
  if (params->size != 1 || results->size != 1 || wasm_valtype_kind(params->data[0]) != WASM_I32 || wasm_valtype_kind(results->data[0]) != WASM_I32) return failure("signature");
  wasm_val_t input = { .kind = WASM_I32, .of.i32 = 1 };
  wasm_val_t output = { .kind = WASM_I32, .of.i32 = 0 };
  wasm_val_vec_t inputs = { .size = 1, .data = &input };
  wasm_val_vec_t outputs = { .size = 1, .data = &output };
  trap = wasm_func_call(function, &inputs, &outputs);
  if (trap || output.kind != WASM_I32 || output.of.i32 != 3) return failure("oracle");
  printf("{\"status\":\"ok\",\"version\":\"%s\",\"backend\":\"%s\",\"result\":\"3\"}\n", wasmer_version(), argv[1]);
  wasm_functype_delete(type);
  wasm_exporttype_vec_delete(&types);
  wasm_extern_vec_delete(&exports);
  wasm_instance_delete(instance);
  wasm_module_delete(module);
  wasm_store_delete(store);
  wasm_engine_delete(engine);
  return 0;
}
