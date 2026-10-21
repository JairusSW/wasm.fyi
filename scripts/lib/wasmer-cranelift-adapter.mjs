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
 const receiptCompilerBlock=`        build.define(
            "WB_WASMER_LLVM",
            Some(if runtime == "wasmer_llvm" { "1" } else { "0" }),
        );`;
 // Older drafts inserted this at the SDK-name expression, before cc::Build
 // existed. Anchor to the actual compiler configuration block instead.
 build=build.replace('\n'+compilerDefinition,'');
 if(build.includes(sdkBlock))build=build.replace(sdkBlock,'if wasmer {\n'+compilerDefinition+'\n        println!("cargo:rerun-if-changed=src/wasmer_wasi.h");');
 else if(build.includes(receiptCompilerBlock))build=build.replace(receiptCompilerBlock,receiptCompilerBlock+'\n'+compilerDefinition);
 else throw Error('Pinned Wasmer SDK compiler-definition seam changed');
 for(const feature of ['SIMD','RELAXED_SIMD','EXCEPTIONS'])main=main.replace(`"${feature}":cfg!(feature="wasmer_llvm")`,`"${feature}":(cfg!(feature="wasmer_llvm") || RUNTIME=="wasmer-cranelift")`);
 main=main.replace('"LEGACY_EXCEPTIONS":(cfg!(feature="wasmer_llvm") || RUNTIME=="wasmer-cranelift")','"LEGACY_EXCEPTIONS":false');
 main=main.replace('"LEGACY_EXCEPTIONS":cfg!(feature="wasmer_llvm")','"LEGACY_EXCEPTIONS":false');
 const tail='"TAIL_CALL":cfg!(feature="wasmer_llvm")';
 main=main.replace('"TAIL_CALL":(cfg!(feature="wasmer_llvm") || RUNTIME=="wasmer-cranelift")',tail);
 if(!main.includes('"THREADS":true'))main=main.replace(tail,tail+',"THREADS":true,"WIDE_ARITHMETIC":(cfg!(feature="wasmer_llvm") || RUNTIME=="wasmer-cranelift")');
 const identityProfile='&& w["host_profile"] == "identity-v1";';
 const threadIdentityProfile='&& ["identity-v1", "threads-identity-v1", "threads-opaque-identity-v1"].contains(&w["host_profile"].as_str().unwrap_or(""));';
 if(main.includes(identityProfile))main=main.replace(identityProfile,threadIdentityProfile);
 const assemblyscriptBlock='let identity_host = ';
 if(!main.includes('let threads_defined_host =')){
  const at=main.indexOf(assemblyscriptBlock);
  if(at<0)throw Error('Pinned Wasmer host-profile seam changed');
  main=main.slice(0,at)+`let threads_defined_host = (cfg!(feature = "wasmer_llvm")
                    || cfg!(feature = "wasmer_singlepass"))
                    && w["host_profile"] == "threads-defined-v1";
`+main.slice(at);
 }
 main=main.replace('if key == "host_profile" && (assemblyscript || identity_host)','if key == "host_profile" && (assemblyscript || identity_host || threads_defined_host)');
 const validatorBlock='                if cfg!(feature = "wasmer_llvm") || cfg!(feature = "wasmer_singlepass") {';
 const capabilityBlock=`                if cfg!(feature = "wasmer_llvm") || cfg!(feature = "wasmer_singlepass") {
                    for profile in ["threads-defined-v1", "threads-identity-v1", "threads-opaque-identity-v1"] {
                        description["description"]["capabilities"][format!("can_host_profile_{profile}")] = json!(true);
                    }`;
 if(!main.includes('for profile in ["threads-defined-v1", "threads-identity-v1", "threads-opaque-identity-v1"]')){
  if(!main.includes(validatorBlock))throw Error('Pinned Wasmer capability seam changed');
  main=main.replace(validatorBlock,capabilityBlock);
 }
 const runtime='let runtime = selected[0];';
 const backend='const auto backend=WB_WASMER_LLVM?LLVM:SINGLEPASS;';
 const descriptor='else if cfg!(feature="wasmer_singlepass"){"singlepass-jit"}';
 if(!build.includes('WASMBENCH_WASMER_COMPILER')){
  if(!build.includes(runtime)||!cpp.includes(backend)||!main.includes(descriptor))throw Error('Pinned Wasmer adapter compiler-selection seam changed');
  build=build.replace(runtime,`${runtime}
    println!("cargo:rerun-if-env-changed=WASMBENCH_WASMER_COMPILER");
    let cranelift = env::var("WASMBENCH_WASMER_COMPILER").is_ok_and(|x| x == "cranelift");
    assert!(!cranelift || runtime == "wasmer_singlepass", "Cranelift requires the Wasmer native transport");`);
  build=build.replace('runtime.replace(\'_\', "-")','if cranelift { "wasmer-cranelift".to_owned() } else { runtime.replace(\'_\', "-") }');
  cpp=cpp.replace(backend,'const auto backend=WB_WASMER_LLVM?LLVM:(WB_WASMER_CRANELIFT?CRANELIFT:SINGLEPASS);');
  main=main.replace(descriptor,'else if cfg!(feature="wasmer_singlepass"){if RUNTIME=="wasmer-cranelift"{"cranelift-jit"}else{"singlepass-jit"}}');
 }
 for(const feature of ['simd','relaxed_simd','exceptions'])cpp=cpp.replace(`wasmer_features_${feature}(features,WB_WASMER_LLVM);`,`wasmer_features_${feature}(features,WB_WASMER_LLVM || WB_WASMER_CRANELIFT);`);
 cpp=cpp.replace('wasmer_features_tail_call(features,WB_WASMER_LLVM || WB_WASMER_CRANELIFT);','wasmer_features_tail_call(features,WB_WASMER_LLVM);');
 if(!cpp.includes('wasmer_features_threads(features,true);'))cpp=cpp.replace('wasmer_features_tail_call(features,WB_WASMER_LLVM);','wasmer_features_tail_call(features,WB_WASMER_LLVM);\n    wasmer_features_threads(features,true);\n    wasmer_features_wide_arithmetic(features,WB_WASMER_LLVM || WB_WASMER_CRANELIFT);');
 await Promise.all([['build.rs',build],['src/main.rs',main],['src/wasmer.cpp',cpp]].map(([name,value])=>writeFile(join(dir,name),value)));
}
