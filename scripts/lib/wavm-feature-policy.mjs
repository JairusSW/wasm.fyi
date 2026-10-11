import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export function withWavmFeaturePolicy(source) {
 const old='struct Engine { wasm_engine_t* value=wasm_engine_new(); ~Engine(){if(value)wasm_engine_delete(value);} };';
 const next='static WAVM::IR::FeatureSpec wb_feature_spec(){ WAVM::IR::FeatureSpec spec; spec.memory64=true; spec.multipleMemories=true; return spec; }\nstruct Engine { wasm_engine_t* value=nullptr; Engine(){auto* config=wasm_config_new(); wasm_config_feature_set_memory64(config,true); wasm_config_feature_set_multimemory(config,true); value=wasm_engine_new_with_config(config);} ~Engine(){if(value)wasm_engine_delete(value);} };';
 if(source.includes('static WAVM::IR::FeatureSpec wb_feature_spec()')){if(source.includes('WAVM::IR::FeatureSpec()')||source.includes('loadBinaryModule(bytes,size,module))'))throw Error('Incomplete WAVM feature policy');return source;}
 if(!source.includes(old)||!source.includes('loadBinaryModule(bytes,size,module))')||!source.includes('WAVM::IR::FeatureSpec()'))throw Error('Unknown WAVM engine/loader configuration seam');
 source=source.replace(old,next).replaceAll('WAVM::IR::FeatureSpec()','wb_feature_spec()');
 source=source.replace('loadBinaryModule(bytes,size,module))','loadBinaryModule(bytes,size,module,wb_feature_spec()))');
 return source;
}
export async function applyWavmFeaturePolicy(harness,sdkSource){
 const cpp=join(sdkSource,'Lib/wavm-c/wavm-c.cpp'),header=join(sdkSource,'Include/WAVM/wavm-c/wavm-c.h');
 for(const [p,old,next] of [[cpp,'IMPLEMENT_FEATURE(multimemory, multipleMemories)','IMPLEMENT_FEATURE(multimemory, multipleMemories)\nIMPLEMENT_FEATURE(memory64, memory64)'],[header,'WASM_DECLARE_FEATURE(multimemory)','WASM_DECLARE_FEATURE(multimemory)\nWASM_DECLARE_FEATURE(memory64)']]){
  let s=await readFile(p,'utf8');if(s.includes(next)|| (p===cpp?/IMPLEMENT_FEATURE\(memory64,\s*memory64\)/.test(s):/WASM_DECLARE_FEATURE\(memory64\)/.test(s)))continue;if(!s.includes(old))throw Error('Unknown WAVM C API feature seam: '+p);await writeFile(p,s.replace(old,next));
 }
 const p=join(harness,'adapters/native/src/wavm.cpp');await writeFile(p,withWavmFeaturePolicy(await readFile(p,'utf8')));
}
