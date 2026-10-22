// Upgrade only known C-API embeddings; unknown constructor layouts stay errors.
export function withWamrRunningMode(embedding) {
 const oldEngine='struct Engine { wasm_engine_t* value=wasm_engine_new(); Engine(){wasm_runtime_set_log_level(WASM_LOG_LEVEL_FATAL);if(!wasm_runtime_register_natives("wasmbench",host_symbols,1))throw std::runtime_error("identity host function registration failed");} ~Engine(){if(value)wasm_engine_delete(value);} };';
 const newEngine=`// wasm.fyi: bind the requested WAMR execution backend before engine creation.
struct Engine { wasm_engine_t* value=nullptr; Engine(){value=wasm_engine_new();if(!value)throw std::runtime_error("engine creation failed");wasm_runtime_set_log_level(getenv("WASMBENCH_WAMR_DIAGNOSTICS")?WASM_LOG_LEVEL_VERBOSE:WASM_LOG_LEVEL_FATAL);const char* selected=getenv("WASMBENCH_WAMR_RUNNING_MODE");RunningMode mode=Mode_Interp;if(selected&&strcmp(selected,"llvm-jit")==0)mode=Mode_LLVM_JIT;else if(selected&&strcmp(selected,"fast-jit")==0)mode=Mode_Fast_JIT;if(!wasm_runtime_is_running_mode_supported(mode)||!wasm_runtime_set_default_running_mode(mode))throw std::runtime_error("requested WAMR running mode is unavailable");if(!wasm_runtime_register_natives("wasmbench",host_symbols,1))throw std::runtime_error("identity host function registration failed");} ~Engine(){if(value)wasm_engine_delete(value);} };`;
 embedding=embedding.replace(String.raw`creation.\nstruct`,`creation.
struct`);
 if(embedding.includes(oldEngine))return embedding.replace(oldEngine,newEngine);
 const current=embedding.match(/^struct Engine \{[^\n]+\};/m)?.[0];
 const modern=current&&['std::getenv("WASMBENCH_WAMR_MODE")','Mode_Interp','Mode_Fast_JIT','Mode_LLVM_JIT','wasm_runtime_is_running_mode_supported(mode)','wasm_runtime_set_default_running_mode(mode)','wasm_runtime_register_natives("wasmbench",host_symbols,1)','wasm_engine_delete(value)'].every(token=>current.includes(token));
 if(modern||embedding.includes('// wasm.fyi: bind the requested WAMR execution backend')){
  if(!current)throw Error('WAMR running-mode adapter anchor changed');
  return embedding.includes('// wasm.fyi: bind the requested WAMR execution backend')?embedding.replace(current,newEngine.slice(newEngine.indexOf('struct Engine'))):embedding.replace(current,newEngine);
 }
 throw Error('WAMR running-mode adapter anchor changed');
}

export function withWamrBackendDescription(main) {
 const backend='if cfg!(feature="wavm") || cfg!(feature="wasmer_llvm"){"llvm-jit"}else if cfg!(feature="wasmer_singlepass"){"singlepass-jit"}else{"interpreter"}';
 const patched='if cfg!(feature="wamr"){match option_env!("WASMBENCH_WAMR_RUNNING_MODE"){Some("llvm-jit")=>"llvm-jit",Some("fast-jit")=>"fast-jit",_=>"interpreter"}}else '+backend;
 if(main.includes('option_env!("WASMBENCH_WAMR_RUNNING_MODE")'))return main;
 if(main.includes(backend))return main.replace(backend,patched);
 const variable='std::env::var("WASMBENCH_WAMR_MODE").unwrap_or_else(|_|"interpreter".to_string())';
 const selected='std::env::var("WASMBENCH_WAMR_RUNNING_MODE").or_else(|_|std::env::var("WASMBENCH_WAMR_MODE")).unwrap_or_else(|_|"interpreter".to_string())';
 if(main.includes('else if cfg!(feature="wamr"){wamr_mode.as_str()}')&&(main.includes(variable)||main.includes(selected)))return main.replace(variable,selected);
 throw Error('WAMR backend description anchor changed');
}
