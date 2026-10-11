import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Reuse the native Wasmer transport, selecting the compiler at build time.
// Each executable keeps its own compiler identity; no runtime fallback.
export async function applyWasmerCraneliftAdapter(root) {
 const dir=join(root,'adapters/native');
 const files=await Promise.all(['build.rs','src/main.rs','src/wasmer.cpp'].map(name=>readFile(join(dir,name),'utf8')));
 let [build,main,cpp]=files;
 const compilerDefinition='        build.define("WB_WASMER_CRANELIFT", Some(if cranelift { "1" } else { "0" }));';
 const sdkBlock='if wasmer {\n        println!("cargo:rerun-if-changed=src/wasmer_wasi.h");';
 // Older drafts inserted this at the SDK-name expression, before cc::Build
 // existed. Anchor to the actual compiler configuration block instead.
 build=build.replace('\n'+compilerDefinition,'');
 if(!build.includes(sdkBlock))throw Error('Pinned Wasmer SDK compiler-definition seam changed');
 build=build.replace(sdkBlock,'if wasmer {\n'+compilerDefinition+'\n        println!("cargo:rerun-if-changed=src/wasmer_wasi.h");');
 for(const feature of ['SIMD','RELAXED_SIMD','EXCEPTIONS','LEGACY_EXCEPTIONS','TAIL_CALL'])main=main.replace(`"${feature}":cfg!(feature="wasmer_llvm")`,`"${feature}":(cfg!(feature="wasmer_llvm") || RUNTIME=="wasmer-cranelift")`);
 if(build.includes('WASMBENCH_WASMER_COMPILER')){
  if(build!==files[0])await writeFile(join(dir,'build.rs'),build);
  if(main!==files[1])await writeFile(join(dir,'src/main.rs'),main);
  return;
 }
 const runtime='let runtime = selected[0];';
 const backend='const auto backend=WB_WASMER_LLVM?LLVM:SINGLEPASS;';
 const descriptor='else if cfg!(feature="wasmer_singlepass"){"singlepass-jit"}';
 if(!build.includes(runtime)||!cpp.includes(backend)||!main.includes(descriptor))throw Error('Pinned Wasmer adapter compiler-selection seam changed');
 build=build.replace(runtime,`${runtime}
    println!("cargo:rerun-if-env-changed=WASMBENCH_WASMER_COMPILER");
    let cranelift = env::var("WASMBENCH_WASMER_COMPILER").is_ok_and(|x| x == "cranelift");
    assert!(!cranelift || runtime == "wasmer_singlepass", "Cranelift requires the Wasmer native transport");`);
 build=build.replace('runtime.replace(\'_\', "-")','if cranelift { "wasmer-cranelift".to_owned() } else { runtime.replace(\'_\', "-") }');
 cpp=cpp.replace(backend,'const auto backend=WB_WASMER_LLVM?LLVM:(WB_WASMER_CRANELIFT?CRANELIFT:SINGLEPASS);');
 for(const feature of ['simd','relaxed_simd','exceptions','tail_call'])cpp=cpp.replace(`wasmer_features_${feature}(features,WB_WASMER_LLVM);`,`wasmer_features_${feature}(features,WB_WASMER_LLVM || WB_WASMER_CRANELIFT);`);
 main=main.replace(descriptor,'else if cfg!(feature="wasmer_singlepass"){if RUNTIME=="wasmer-cranelift"{"cranelift-jit"}else{"singlepass-jit"}}');
 await Promise.all([['build.rs',build],['src/main.rs',main],['src/wasmer.cpp',cpp]].map(([name,value])=>writeFile(join(dir,name),value)));
}
