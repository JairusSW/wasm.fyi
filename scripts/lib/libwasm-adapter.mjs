import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

function replaceOnce(source,seam,replacement,label){
 const parts=source.split(seam);
 if(parts.length!==2)throw Error(`LibWasm ${label} seam changed`);
 return parts.join(replacement);
}

export async function prepareLibWasmAdapter(template,directory,apiHeader,libwasmSource){
 const target=join(directory,'adapter-native');
 await rm(target,{recursive:true,force:true});
 await mkdir(directory,{recursive:true});
 await cp(template,target,{recursive:true});
 const sourcePath=join(target,'src/libwasm.cpp');
 const original=await readFile(sourcePath,'utf8');
 let source=original;
 const policies=[];
 if(apiHeader.includes('namespace Wasm::Runtime')){
  if(!libwasmSource)throw Error('Current LibWasm adapter requires its pinned source checkout');
  const cargoPath=join(target,'Cargo.toml'),buildPath=join(target,'build.rs'),mainPath=join(target,'src/main.rs');
  let cargo=await readFile(cargoPath,'utf8'),build=await readFile(buildPath,'utf8'),main=await readFile(mainPath,'utf8');
  cargo=replaceOnce(cargo,'libwasm = []','libwasm = []\nlibwasm_runtime = ["dep:libwasm_engine"]\nlibwasm_jit = ["dep:libwasm_engine"]','Cargo feature');
  cargo=replaceOnce(cargo,'[build-dependencies]','libwasm_engine = { path = '+JSON.stringify(join(libwasmSource,'Libraries/LibWasm/Engine'))+', optional = true }\n\n[build-dependencies]','Cargo dependency');
  build=replaceOnce(build,'        "libwasm",','        "libwasm",\n        "libwasm_runtime",\n        "libwasm_jit",','build selection');
  build=replaceOnce(build,'    println!("cargo:rustc-env=WB_RUNTIME={}", runtime.replace(\'_\', "-"));','    let runtime_id=if runtime=="libwasm_runtime"{"libwasm"}else{runtime};\n    println!("cargo:rustc-env=WB_RUNTIME={}", runtime_id.replace(\'_\', "-"));','runtime identity');
  build=replaceOnce(build,'    if runtime=="libwasm" {','    if runtime=="libwasm_runtime" || runtime=="libwasm_jit" { return; }\n    if runtime=="libwasm" {','build dispatch');
  const rustModes='feature = "libwasm_runtime", feature = "libwasm_jit"';
  const jitModes='feature = "libwasm_jit"';
  main=replaceOnce(main,'#[cfg(not(any(feature = "wasmi", feature = "aot")))]\nmod ffi;\n#[cfg(not(any(feature = "wasmi", feature = "aot")))]\nuse ffi as embedding;',`#[cfg(not(any(feature = "wasmi", feature = "aot", ${rustModes})))]\nmod ffi;\n#[cfg(not(any(feature = "wasmi", feature = "aot", ${rustModes})))]\nuse ffi as embedding;\n#[cfg(any(${rustModes}))]\nmod libwasm_jit;\n#[cfg(any(${rustModes}))]\nuse libwasm_jit as embedding;`,'Rust embedding selection');
  main=main.replaceAll('cfg!(feature = "libwasm")','__WASMFYI_LIBWASM_CFG__');
  main=main.replaceAll('feature = "libwasm"',`feature = "libwasm", ${rustModes}`);
  main=main.replaceAll('__WASMFYI_LIBWASM_CFG__','(cfg!(feature = "libwasm") || cfg!(feature = "libwasm_runtime") || cfg!(feature = "libwasm_jit"))');
  main=main.replaceAll('cfg!(feature="libwasm")','(cfg!(feature="libwasm") || cfg!(feature="libwasm_runtime") || cfg!(feature="libwasm_jit"))');
  main=replaceOnce(main,'else if cfg!(feature="wasmedge"){wasmedge_mode.as_str()}else{"interpreter"}','else if cfg!(feature="wasmedge"){wasmedge_mode.as_str()}else if cfg!(feature="libwasm_jit"){"optimizing-jit-tiered"}else{"interpreter"}','backend description');
  main=replaceOnce(main,'else{"eager module API; engine creation excluded"}','else if cfg!(feature="libwasm_jit"){"validated module compilation; hot-function tiering during execution; engine creation excluded"}else{"eager module API; engine creation excluded"}','compile policy');
  main=replaceOnce(main,'            #[cfg(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge"))]\n            "inspect" => {',`            #[cfg(any(${jitModes}))]\n            "inspect" => {\n                ensure!(self.prep.is_some(), "prepare required");\n                embedding::enable_native_size_capture();\n                let engine = embedding::Engine::new()?;\n                let module = engine.compile(&self.bytes)?;\n                let instance = engine.instantiate(&module)?;\n                let size = instance.native_size()?;\n                Ok(json!({"diagnostics":[{"metric":"native.code_size","definition_version":1,"status":"available","value":size,"unit":"bytes","scope":"compiled_module","phase":"instantiate","collector":"LibWasm/perf-map/wasm-function","collector_version":embedding::version(),"quality":"engine_reported","profile":"code","normalization_denominator":"module","reason":"Sum of exact installed wasm-function native extents; excludes entry trampolines and runtime adapters. Code inspection eagerly compiles all functions without changing timed-run policy."}]}))\n            }\n            #[cfg(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge"))]\n            "inspect" => {`,'native size inspection');
  main=replaceOnce(main,'#[cfg(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge"))]\n                let native_size_profile = embedding::can_native_size() && p["profile"] == "code";\n                #[cfg(not(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge")))]\n                let native_size_profile = false;',`#[cfg(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge"))]\n                let native_size_profile = embedding::can_native_size() && p["profile"] == "code";\n                #[cfg(any(${jitModes}))]\n                let native_size_profile = p["profile"] == "code";\n                #[cfg(not(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge", ${jitModes})))]\n                let native_size_profile = false;`,'native size profile');
  await writeFile(cargoPath,cargo);await writeFile(buildPath,build);await writeFile(mainPath,main);
  await cp(new URL('../libwasm/libwasm-jit.rs',import.meta.url),join(target,'src/libwasm_jit.rs'));
  policies.push('rust-runtime-jit');
 } else if(!apiHeader.includes('ResultsStaticSize')){
  const seam='Vector<Wasm::Value,Wasm::ResultsStaticSize>';
  if(!source.includes(seam))throw Error('LibWasm host-result adapter seam changed');
  source=source.replaceAll(seam,'Vector<Wasm::Value>');
  policies.push('dynamic-result-vector');
 }
 if(!apiHeader.includes('namespace Wasm::Runtime')&&!apiHeader.includes('contiguous_bytes_from')){
  const seam='if(memory->data().contiguous_bytes_from(0,*n)!=*n)throw std::runtime_error("unsupported: segmented linear-memory view");';
  if(!source.includes(seam))throw Error('LibWasm contiguous-memory adapter seam changed');
  source=source.replace(seam,'');
  policies.push('legacy-contiguous-memory');
 }
 if(source!==original)await writeFile(sourcePath,source);
 const policy=policies.join('+')||'current-api';
 const receipt={policy,templateSha256:digest(Buffer.from(original)),sourceSha256:digest(Buffer.from(source))};
 await writeFile(join(directory,'adapter-compatibility.json'),JSON.stringify(receipt,null,2)+'\n');
 return {root:target,receipt};
}
