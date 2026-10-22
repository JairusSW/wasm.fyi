import test from 'node:test';import assert from 'node:assert/strict';
import {withWamrRunningMode,withWamrBackendDescription} from './lib/wamr-running-mode.mjs';
const modern=`struct Engine { wasm_engine_t* value=wasm_engine_new(); Engine(){auto selected=std::getenv("WASMBENCH_WAMR_MODE");RunningMode mode=Mode_Interp;if(selected&&strcmp(selected,"fast-jit")==0)mode=Mode_Fast_JIT;else if(selected&&strcmp(selected,"llvm-jit")==0)mode=Mode_LLVM_JIT;if(!wasm_runtime_is_running_mode_supported(mode)||!wasm_runtime_set_default_running_mode(mode))throw std::runtime_error("unsupported");if(!wasm_runtime_register_natives("wasmbench",host_symbols,1))throw std::runtime_error("registration");} ~Engine(){if(value)wasm_engine_delete(value);} };`;
test('upgrades a known already backend-aware C-API constructor',()=>{
 const changed=withWamrRunningMode(modern);assert(changed.includes('WASMBENCH_WAMR_RUNNING_MODE'));assert(changed.includes('if(!value)'));assert.equal(withWamrRunningMode(changed),changed);
});
test('refuses incomplete backend guards or unrelated constructors',()=>{
 for(const s of [modern.replace('wasm_runtime_is_running_mode_supported(mode)','true'),modern.replace('Mode_LLVM_JIT','Mode_Unknown'),'struct Engine {};'])assert.throws(()=>withWamrRunningMode(s),/anchor changed/);
});

test('modern backend descriptions agree with the SDK-selected execution mode',()=>{
 const source='let wamr_mode=std::env::var("WASMBENCH_WAMR_MODE").unwrap_or_else(|_|"interpreter".to_string()); else if cfg!(feature="wamr"){wamr_mode.as_str()}';
 const patched=withWamrBackendDescription(source);assert(patched.includes('std::env::var("WASMBENCH_WAMR_RUNNING_MODE").or_else'));assert.equal(withWamrBackendDescription(patched),patched);
 assert.throws(()=>withWamrBackendDescription(source.replace('wamr_mode.as_str()','unknown()')),/anchor changed/);
});

test('legacy backend projection upgrades once',()=>{
 const legacy='if cfg!(feature="wavm") || cfg!(feature="wasmer_llvm"){"llvm-jit"}else if cfg!(feature="wasmer_singlepass"){"singlepass-jit"}else{"interpreter"}';
 const patched=withWamrBackendDescription(legacy);assert(patched.includes('option_env!'));assert.equal(withWamrBackendDescription(patched),patched);
});
