import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {applyWasmerCraneliftAdapter} from './lib/wasmer-cranelift-adapter.mjs';

test('Cranelift selects its actual SDK compiler and preserves Singlepass identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmer-selection-'));
 try {
  const dir=join(root,'adapters/native');await mkdir(join(dir,'src'),{recursive:true});
  await writeFile(join(dir,'build.rs'),`let runtime = selected[0];
println!("cargo:rustc-env=WB_RUNTIME={}", runtime.replace('_', "-"));
let sdk_runtime = if wasmer { "wasmer" } else { runtime };
let mut build = cc::Build::new();
if wasmer {
        println!("cargo:rerun-if-changed=src/wasmer_wasi.h");
        build.define("WB_WASMER_LLVM", Some("0")); }`);
  await writeFile(join(dir,'src/main.rs'),`else if cfg!(feature="wasmer_singlepass"){"singlepass-jit"}
"SIMD":cfg!(feature="wasmer_llvm"),"LEGACY_EXCEPTIONS":cfg!(feature="wasmer_llvm"),"TAIL_CALL":cfg!(feature="wasmer_llvm")
let identity_host = true && w["host_profile"] == "identity-v1";
                if cfg!(feature = "wasmer_llvm") || cfg!(feature = "wasmer_singlepass") {
                    description["description"]["validator_features"] = json!({});
                }`);
  await writeFile(join(dir,'src/wasmer.cpp'),`const auto backend=WB_WASMER_LLVM?LLVM:SINGLEPASS;
wasmer_features_simd(features,WB_WASMER_LLVM);
wasmer_features_relaxed_simd(features,WB_WASMER_LLVM);
wasmer_features_exceptions(features,WB_WASMER_LLVM);
wasmer_features_tail_call(features,WB_WASMER_LLVM);`);
  await applyWasmerCraneliftAdapter(root);
  const paths=['build.rs','src/main.rs','src/wasmer.cpp'];
  const first=await Promise.all(paths.map(name=>readFile(join(dir,name),'utf8')));
  assert.match(first[0],/WB_WASMER_CRANELIFT/);
  assert.ok(first[0].indexOf('build.define("WB_WASMER_CRANELIFT"')>first[0].indexOf('let mut build ='));
  assert.match(first[0],/"wasmer-cranelift"\.to_owned\(\)/);
  assert.match(first[1],/RUNTIME=="wasmer-cranelift"\{"cranelift-jit"\}else\{"singlepass-jit"\}/);
  assert.match(first[1],/"SIMD":\(cfg!\(feature="wasmer_llvm"\) \|\| RUNTIME=="wasmer-cranelift"\)/);
  assert.match(first[1],/"TAIL_CALL":cfg!\(feature="wasmer_llvm"\)/);
  assert.match(first[1],/"LEGACY_EXCEPTIONS":false/);
  assert.match(first[1],/"THREADS":true/);
  assert.match(first[1],/"WIDE_ARITHMETIC":\(cfg!\(feature="wasmer_llvm"\) \|\| RUNTIME=="wasmer-cranelift"\)/);
  assert.match(first[1],/threads-opaque-identity-v1/);
  assert.match(first[1],/let threads_defined_host =/);
  assert.match(first[1],/can_host_profile_\{profile\}/);
  assert.match(first[2],/WB_WASMER_CRANELIFT\?CRANELIFT:SINGLEPASS/);
  assert.equal((first[2].match(/WB_WASMER_LLVM \|\| WB_WASMER_CRANELIFT/g)||[]).length,4);
  assert.match(first[2],/wasmer_features_tail_call\(features,WB_WASMER_LLVM\)/);
  assert.match(first[2],/wasmer_features_threads\(features,true\)/);
  await applyWasmerCraneliftAdapter(root);
  assert.deepEqual(await Promise.all(paths.map(name=>readFile(join(dir,name),'utf8'))),first);
  await writeFile(join(dir,'build.rs'),'upstream selection changed');
  await assert.rejects(applyWasmerCraneliftAdapter(root),/seam changed/);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('Cranelift compiler define follows the receipt-aware Wasmer SDK block',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmer-receipt-selection-'));
 try {
  const dir=join(root,'adapters/native');await mkdir(join(dir,'src'),{recursive:true});
  await writeFile(join(dir,'build.rs'),`let runtime = selected[0];
println!("cargo:rustc-env=WB_RUNTIME={}", runtime.replace('_', "-"));
let sdk_runtime = if wasmer { "wasmer" } else { runtime };
let mut build = cc::Build::new();
if wasmer {
        let receipt = sdk.join("receipt.json");
        build.define(
            "WB_WASMER_LLVM",
            Some(if runtime == "wasmer_llvm" { "1" } else { "0" }),
        );
}`);
  await writeFile(join(dir,'src/main.rs'),`else if cfg!(feature="wasmer_singlepass"){"singlepass-jit"}
"SIMD":cfg!(feature="wasmer_llvm"),"LEGACY_EXCEPTIONS":cfg!(feature="wasmer_llvm"),"TAIL_CALL":cfg!(feature="wasmer_llvm")
let identity_host = true && w["host_profile"] == "identity-v1";
                if cfg!(feature = "wasmer_llvm") || cfg!(feature = "wasmer_singlepass") {}`);
  await writeFile(join(dir,'src/wasmer.cpp'),`const auto backend=WB_WASMER_LLVM?LLVM:SINGLEPASS;
wasmer_features_simd(features,WB_WASMER_LLVM);
wasmer_features_relaxed_simd(features,WB_WASMER_LLVM);
wasmer_features_exceptions(features,WB_WASMER_LLVM);
wasmer_features_tail_call(features,WB_WASMER_LLVM);`);
  await applyWasmerCraneliftAdapter(root);
  const build=await readFile(join(dir,'build.rs'),'utf8');
  assert.match(await readFile(join(dir,'src/main.rs'),'utf8'),/"LEGACY_EXCEPTIONS":false/);
  assert.ok(build.indexOf('build.define("WB_WASMER_CRANELIFT"')>build.indexOf('let mut build ='));
  assert.equal((build.match(/WB_WASMER_CRANELIFT/g)||[]).length,1);
  await applyWasmerCraneliftAdapter(root);
  assert.equal(await readFile(join(dir,'build.rs'),'utf8'),build);
 } finally {await rm(root,{recursive:true,force:true});}
});
