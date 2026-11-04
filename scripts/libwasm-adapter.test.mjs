import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareLibWasmAdapter} from './lib/libwasm-adapter.mjs';

test('historical LibWasm result vectors are adapted per SDK without mutating the frozen template',async()=>{
 const root=await mkdtemp(join(tmpdir(),'libwasm-adapter-'));
 try{
  const template=join(root,'template');await mkdir(join(template,'src'),{recursive:true});
  const memory='if(memory->data().contiguous_bytes_from(0,*n)!=*n)throw std::runtime_error("unsupported: segmented linear-memory view");';
  const original='auto f(){ Vector<Wasm::Value,Wasm::ResultsStaticSize> result; '+memory+' }\n';
  await writeFile(join(template,'src/libwasm.cpp'),original);await writeFile(join(template,'Cargo.toml'),'[package]\nname="fixture"\nversion="0.0.0"\n');
  const old=await prepareLibWasmAdapter(template,join(root,'old'),'constexpr inline size_t ArgumentsStaticSize = 3;');
  assert.equal(old.receipt.policy,'dynamic-result-vector+legacy-contiguous-memory');
  const oldSource=await readFile(join(old.root,'src/libwasm.cpp'),'utf8');
  assert.match(oldSource,/Vector<Wasm::Value> result/);assert.doesNotMatch(oldSource,/contiguous_bytes_from/);
  assert.equal(await readFile(join(template,'src/libwasm.cpp'),'utf8'),original);
  const current=await prepareLibWasmAdapter(template,join(root,'current'),'constexpr inline size_t ResultsStaticSize = 1; size_t contiguous_bytes_from(size_t,size_t);');
  assert.equal(current.receipt.policy,'current-api');assert.equal(await readFile(join(current.root,'src/libwasm.cpp'),'utf8'),original);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('current Rust LibWasm gets a distinct optimizing-JIT embedding',async()=>{
 const root=await mkdtemp(join(tmpdir(),'libwasm-jit-adapter-'));
 try{
  const template=join(root,'template'),source=join(root,'ladybird');await mkdir(join(template,'src'),{recursive:true});
  await mkdir(join(source,'Libraries/LibWasm/Engine'),{recursive:true});
  await writeFile(join(template,'src/libwasm.cpp'),'old C++ adapter\n');
  await writeFile(join(template,'Cargo.toml'),'[features]\nlibwasm = []\n\n[build-dependencies]\ncc = "1"\n');
  await writeFile(join(template,'build.rs'),'fn main(){let selected=[\n        "libwasm",\n];\n    println!("cargo:rustc-env=WB_RUNTIME={}", runtime.replace(\'_\', "-"));\n    if runtime=="libwasm" {}}\n');
  await writeFile(join(template,'src/main.rs'),'#[cfg(not(any(feature = "wasmi", feature = "aot")))]\nmod ffi;\n#[cfg(not(any(feature = "wasmi", feature = "aot")))]\nuse ffi as embedding;\n#[cfg(any(feature = "aot", feature = "libwasm"))]\nmod vectors;\nfn x(){let _=cfg!(feature="libwasm");let _=cfg!(feature = "libwasm");let _=if cfg!(feature="wamr"){"x"}else if cfg!(feature="wasmedge"){wasmedge_mode.as_str()}else{"interpreter"};let _=if cfg!(feature="wasmedge"){"x"}else{"eager module API; engine creation excluded"};}\n            #[cfg(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge"))]\n            "inspect" => {\n#[cfg(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge"))]\n                let native_size_profile = embedding::can_native_size() && p["profile"] == "code";\n                #[cfg(not(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge")))]\n                let native_size_profile = false;\n');
  const prepared=await prepareLibWasmAdapter(template,join(root,'out'),'namespace Wasm::Runtime { class Store; }',source);
  assert.equal(prepared.receipt.policy,'rust-runtime-jit');
  const cargo=await readFile(join(prepared.root,'Cargo.toml'),'utf8');
  assert.match(cargo,/libwasm_runtime = \["dep:libwasm_engine"\]/);assert.match(cargo,/libwasm_jit = \["dep:libwasm_engine"\]/);assert.doesNotMatch(cargo,/libwasm_jit_(?:forced|eager)/);assert.match(cargo,/Libraries\/LibWasm\/Engine/);
  const main=await readFile(join(prepared.root,'src/main.rs'),'utf8');
  assert.match(main,/mod libwasm_jit/);assert.match(main,/optimizing-jit/);assert.match(main,/cfg!\(feature = "libwasm_jit"\)/);
  assert.match(main,/LibWasm\/perf-map\/wasm-function/);assert.doesNotMatch(main,/feature = "libwasm_jit_(?:forced|eager)"/);assert.match(main,/let native_size_profile = p\["profile"\] == "code"/);
  assert.match(await readFile(join(prepared.root,'src/libwasm_jit.rs'),'utf8'),/libwasm_engine/);
  assert.equal(await readFile(join(template,'src/libwasm.cpp'),'utf8'),'old C++ adapter\n');
 }finally{await rm(root,{recursive:true,force:true})}
});
