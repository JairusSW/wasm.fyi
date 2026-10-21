import test from 'node:test';
import assert from 'node:assert/strict';
import {withWasmtimeDeclaredFeatures} from './lib/wasmtime-feature-policy.mjs';

const source=`fn policy(winch: bool) {
        ("WIDE_ARITHMETIC", WasmFeatures::WIDE_ARITHMETIC, !winch || cfg!(target_arch = "x86_64")),
}
fn configure(config: &mut Config, winch: bool) {
    config.wasm_branch_hinting(!winch);
}
const EVIDENCE: &str = "threads, GC runtime support and shared memories;";
fn verify(winch: bool) {
            assert_eq!(describe(winch)["supported"]["THREADS"], json!(!winch || cfg!(target_arch = "x86_64")));
}`;

test('enables source-declared shared-everything threads only for Cranelift',()=>{
 const result=withWasmtimeDeclaredFeatures(source);
 assert.match(result.source,/SHARED_EVERYTHING_THREADS.*, !winch/);
 assert.match(result.source,/wasm_shared_everything_threads\(!winch\)/);
 assert.match(result.source,/shared-everything threads/);
 assert.deepEqual(withWasmtimeDeclaredFeatures(result.source),{source:result.source,alreadyApplied:true});
});

test('rejects a partial shared-everything feature policy',()=>{
 assert.throws(()=>withWasmtimeDeclaredFeatures(source.replace('fn configure(config: &mut Config, winch: bool) {','fn configure(config: &mut Config, winch: bool) {\n    config.wasm_shared_everything_threads(!winch);')),/Partial Wasmtime/);
});
