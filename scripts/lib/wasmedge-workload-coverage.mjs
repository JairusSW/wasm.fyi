// Adapter-only transport coverage; the pinned WasmEdge SDK is unchanged.
const marker='WASMFYI_WASMEDGE_WORKLOAD_COVERAGE_V1';
function once(s,b,a,n){if(s.split(b).length!==2)throw Error('WasmEdge coverage seam changed: '+n);return s.replace(b,a)}
export function wasmedgeWorkloadCoverageSources({main,ffi,cpp}){
 if([main,ffi,cpp].every(s=>s.includes(marker)))return{main,ffi,cpp};
 if([main,ffi,cpp].some(s=>s.includes(marker)))throw Error('Partial WasmEdge coverage patch');
 main=once(main,'    feature = "wavm"\n))]\nmod vectors;','    feature = "wavm",\n    feature = "wasmedge"\n))]\nmod vectors;','vectors module');
 const cfgGroup='feature = "wavm"\n                ))]';if(main.split(cfgGroup).length!==3)throw Error('WasmEdge vector dispatch seam changed');main=main.replaceAll(cfgGroup,'feature = "wavm",\n                    feature = "wasmedge"\n                ))]');
 main=once(main,'|| cfg!(feature = "wavm"))\n                    && w["oracle"]["kind"]','|| cfg!(feature = "wavm")\n                    || cfg!(feature = "wasmedge"))\n                    && w["oracle"]["kind"]','vector contract');
 main=once(main,'|| cfg!(feature = "wavm"))\n                    && w["host_profile"] == "assemblyscript-abort-v1"','|| cfg!(feature = "wavm")\n                    || cfg!(feature = "wasmedge"))\n                    && w["host_profile"] == "assemblyscript-abort-v1"','AS profile');
 const cap='if cfg!(feature = "wasmer_llvm")\n                    || cfg!(feature = "wasmer_singlepass")\n                    || cfg!(feature = "wavm")\n                {';main=once(main,cap,cap.replace('|| cfg!(feature = "wavm")','|| cfg!(feature = "wavm")\n                    || cfg!(feature = "wasmedge")'),'describe');
 main=once(main,'                self.bytes = bytes;\n                self.prep = Some(p.clone());','                #[cfg(feature = "wasmedge")]\n                embedding::set_assemblyscript_profile(assemblyscript);\n                self.bytes = bytes;\n                self.prep = Some(p.clone());','requested profile');main='// '+marker+'\n'+main;
 ffi='// '+marker+'\n'+ffi+'\n#[cfg(feature = "wasmedge")]\nunsafe extern "C" { fn wb_assemblyscript_profile(enabled: bool); }\n#[cfg(feature = "wasmedge")]\npub fn set_assemblyscript_profile(enabled: bool) { unsafe { wb_assemblyscript_profile(enabled) } }\n';
 cpp=once(cpp,'#include <memory>','#include <memory>\nstatic bool assemblyscript_profile_requested=false;\nextern "C" void wb_assemblyscript_profile(bool enabled){assemblyscript_profile_requested=enabled;}','profile state');
 cpp=once(cpp,'    WasmEdge_ModuleInstanceContext* module=nullptr;','    WasmEdge_ModuleInstanceContext* module=nullptr;\n    WasmEdge_ModuleInstanceContext* assemblyscript_host=nullptr;','host lifetime');
 cpp=once(cpp,'if(module)WasmEdge_ModuleInstanceDelete(module);','if(module)WasmEdge_ModuleInstanceDelete(module);if(assemblyscript_host)WasmEdge_ModuleInstanceDelete(assemblyscript_host);','host release');
 const callback=`static WasmEdge_Result assemblyscript_abort(void*,const WasmEdge_CallingFrameContext*,const WasmEdge_Value*,WasmEdge_Value*){return WasmEdge_ResultGen(WasmEdge_ErrCategory_UserLevelError,1);}
static void register_assemblyscript(Instance* i){
 if(!assemblyscript_profile_requested)return;
 i->assemblyscript_host=WasmEdge_ModuleInstanceCreate(WasmEdge_StringWrap("env",3));
 if(!i->assemblyscript_host)throw std::runtime_error("AssemblyScript host module creation failed");
 WasmEdge_ValType params[4]={WasmEdge_ValTypeGenI32(),WasmEdge_ValTypeGenI32(),WasmEdge_ValTypeGenI32(),WasmEdge_ValTypeGenI32()};
 auto signature=WasmEdge_FunctionTypeCreate(params,4,nullptr,0);if(!signature)throw std::runtime_error("AssemblyScript abort signature creation failed");
 auto callback=WasmEdge_FunctionInstanceCreate(signature,assemblyscript_abort,nullptr,0);WasmEdge_FunctionTypeDelete(signature);
 if(!callback)throw std::runtime_error("AssemblyScript abort function creation failed");
 WasmEdge_ModuleInstanceAddFunction(i->assemblyscript_host,WasmEdge_StringWrap("abort",5),callback);
 check(WasmEdge_ExecutorRegisterImport(i->executor,i->store,i->assemblyscript_host));
}
`;
 cpp=once(cpp,'static const WasmEdge_FunctionInstanceContext* function(',callback+'static const WasmEdge_FunctionInstanceContext* function(','callback');
 cpp=once(cpp,'if(!i->executor||!i->store)throw std::runtime_error("executor/store creation failed");','if(!i->executor||!i->store)throw std::runtime_error("executor/store creation failed");register_assemblyscript(i.get());','instance imports');cpp='// '+marker+'\n'+cpp;
 return{main,ffi,cpp};
}

export async function applyWasmEdgeWorkloadCoverage(root){
 const {readFile,writeFile}=await import('node:fs/promises');const {join}=await import('node:path');const {createHash}=await import('node:crypto');
 const hash=s=>createHash('sha256').update(s).digest('hex'),paths={main:join(root,'adapters/native/src/main.rs'),ffi:join(root,'adapters/native/src/ffi.rs'),cpp:join(root,'adapters/native/src/wasmedge.cpp')},before={};
 for(const[k,p]of Object.entries(paths))before[k]=await readFile(p,'utf8');const after=wasmedgeWorkloadCoverageSources(before),provenance={marker,engineSDKChanged:false,preimages:{},postimages:{}};
 for(const[k,p]of Object.entries(paths)){provenance.preimages[k]=hash(before[k]);provenance.postimages[k]=hash(after[k]);if(before[k]!==after[k]){await writeFile(p+'.wasmfyi-coverage-original',before[k]);await writeFile(p,after[k])}}
 return provenance;
}
