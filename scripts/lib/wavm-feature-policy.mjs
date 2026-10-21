import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

export function withWavmMemory64CAPI(header,implementation){
 const headerAnchor='WASM_DECLARE_FEATURE(multimemory)';
 const implementationAnchor='IMPLEMENT_FEATURE(multimemory, multipleMemories)';
 if(!header.includes(headerAnchor)||!implementation.includes(implementationAnchor))throw Error('WAVM memory64 C API seam changed');
 if(!header.includes('WASM_DECLARE_FEATURE(memory64)'))header=header.replace(headerAnchor,headerAnchor+'\nWASM_DECLARE_FEATURE(memory64)');
 if(!implementation.includes('IMPLEMENT_FEATURE(memory64, memory64)'))implementation=implementation.replace(implementationAnchor,implementationAnchor+'\nIMPLEMENT_FEATURE(memory64, memory64)');
 return {header,implementation};
}

export function withWavmFeatureEngine(source){
 const marker='// wasm-fyi declared WAVM feature policy v1';
 if(source.includes(marker))return source;
 const anchor='struct Engine { wasm_engine_t* value=wasm_engine_new(); ~Engine(){if(value)wasm_engine_delete(value);} };';
 if(!source.includes(anchor))throw Error('WAVM engine configuration seam changed');
 return source.replace(anchor,`${marker}\nstruct Engine {\n    wasm_engine_t* value=nullptr;\n    Engine(){\n        auto* config=wasm_config_new();\n        wasm_config_feature_set_simd(config,true);\n        wasm_config_feature_set_atomics(config,true);\n        wasm_config_feature_set_exception_handling(config,true);\n        wasm_config_feature_set_multivalue(config,true);\n        wasm_config_feature_set_reference_types(config,true);\n        wasm_config_feature_set_extended_name_section(config,true);\n        wasm_config_feature_set_multimemory(config,true);\n        wasm_config_feature_set_memory64(config,true);\n        value=wasm_engine_new_with_config(config);\n    }\n    ~Engine(){if(value)wasm_engine_delete(value);}\n};`);
}

export function withWavmDiagnosticFeatures(source){
 const marker='// wasm-fyi source-declared WAVM diagnostic features v1';
 if(source.includes(marker))return source;
 const anchor='WAVM::IR::FeatureSpec(),&error';
 if(!source.includes(anchor))throw Error('WAVM diagnostic feature seam changed');
 return source.replaceAll(anchor,'WAVM::IR::FeatureSpec(WAVM::IR::FeatureLevel::proposed),&error')+'\n'+marker+'\n';
}

export async function applyWavmFeaturePolicy(source,harness){
 const headerPath=join(source,'Include/WAVM/wavm-c/wavm-c.h'),implementationPath=join(source,'Lib/wavm-c/wavm-c.cpp'),adapterPath=join(harness,'adapters/native/src/wavm.cpp');
 const header=await readFile(headerPath,'utf8'),implementation=await readFile(implementationPath,'utf8'),adapter=await readFile(adapterPath,'utf8');
 const capi=withWavmMemory64CAPI(header,implementation),after=withWavmDiagnosticFeatures(withWavmFeatureEngine(adapter));
 if(capi.header!==header)await writeFile(headerPath,capi.header);if(capi.implementation!==implementation)await writeFile(implementationPath,capi.implementation);if(after!==adapter)await writeFile(adapterPath,after);
 return {version:'wavm-declared-features-v1',features:['simd','atomics','exception-handling','multivalue','reference-types','extended-name-section','multi-memory','memory64'],headerSha256:digest(Buffer.from(capi.header)),implementationSha256:digest(Buffer.from(capi.implementation)),adapterSha256:digest(Buffer.from(after))};
}
