// Native WAMR workload transport only; does not change the pinned engine SDK.
const marker='WASMFYI_WAMR_WORKLOAD_COVERAGE_V1';
function once(source,before,after,name){if(source.split(before).length!==2)throw Error('WAMR coverage source seam changed: '+name);return source.replace(before,after)}
export function wamrWorkloadCoverageSources({main,ffi,cpp}){
 if([main,ffi,cpp].every(s=>s.includes(marker)))return{main,ffi,cpp};
 if([main,ffi,cpp].some(s=>s.includes(marker)))throw Error('Partial WAMR coverage patch');
 // Enable only the existing vector transport dispatch and advertised phases.
 main=once(main,'    feature = "libwasm"\n))]\nmod vectors;','    feature = "libwasm",\n    feature = "wamr"\n))]\nmod vectors;','vector module');
 const group='feature = "aot", feature = "libwasm"';if(main.split(group).length!==3)throw Error('WAMR vector dispatch cfg group changed');main=main.replaceAll(group,group+', feature = "wamr"');
 main=once(main,'|| cfg!(feature = "aot") || cfg!(feature = "libwasm"))\n                    && w["oracle"]["kind"]','|| cfg!(feature = "aot") || cfg!(feature = "libwasm") || cfg!(feature = "wamr"))\n                    && w["oracle"]["kind"]','vector contract');
 main=once(main,'|| cfg!(feature = "aot"))\n                    && w["host_profile"] == "assemblyscript-abort-v1"','|| cfg!(feature = "aot") || cfg!(feature = "wamr"))\n                    && w["host_profile"] == "assemblyscript-abort-v1"','AS profile');
 const cap='if cfg!(feature = "wasmer_llvm")\n                    || cfg!(feature = "wasmer_singlepass")\n                    || cfg!(feature = "wavm")\n                {';main=once(main,cap,cap.replace('|| cfg!(feature = "wavm")','|| cfg!(feature = "wavm")\n                    || cfg!(feature = "wamr")'),'describe vector capabilities');
 main=once(main,'                self.bytes = bytes;\n                self.prep = Some(p.clone());','                #[cfg(feature = "wamr")]\n                embedding::set_assemblyscript_profile(assemblyscript);\n                self.bytes = bytes;\n                self.prep = Some(p.clone());','profile-requested native imports');main='// '+marker+'\n'+main;
 ffi='// '+marker+'\n'+ffi+'\n#[cfg(feature = "wamr")]\nunsafe extern "C" { fn wb_assemblyscript_profile(enabled: bool); }\n#[cfg(feature = "wamr")]\npub fn set_assemblyscript_profile(enabled: bool) { unsafe { wb_assemblyscript_profile(enabled) } }\n';
 const callback=`// ${marker}
static bool assemblyscript_profile_requested=false;
extern "C" void wb_assemblyscript_profile(bool enabled){assemblyscript_profile_requested=enabled;}
static void host_assemblyscript_abort(wasm_exec_env_t env,int32_t,int32_t,int32_t,int32_t){
    wasm_runtime_set_exception(wasm_runtime_get_module_inst(env),"assemblyscript-abort-v1: abort called");
}
static NativeSymbol assemblyscript_symbols[]={{"abort",reinterpret_cast<void*>(host_assemblyscript_abort),"(iiii)",nullptr}};
`;
 cpp=once(cpp,'// WAMR\'s native ABI passes the execution environment as the hidden first arg.',callback+'// WAMR\'s native ABI passes the execution environment as the hidden first arg.','native callback');
 const registration='if(!wasm_runtime_register_natives("wasmbench",host_symbols,1))throw std::runtime_error("identity host function registration failed");';cpp=once(cpp,registration,registration+'wasm_runtime_unregister_natives("env",assemblyscript_symbols);if(assemblyscript_profile_requested&&!wasm_runtime_register_natives("env",assemblyscript_symbols,1))throw std::runtime_error("AssemblyScript abort native registration failed");','profile-requested registry');
 return{main,ffi,cpp};
}
