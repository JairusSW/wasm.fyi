import test from 'node:test';
import assert from 'node:assert/strict';
import {withWasmtimeCoreProposals,withWasmtimeFeatureCrates,wasmtimeProposalsForBackend,WASMTIME_FEATURE_POLICY} from './lib/wasmtime-feature-policy.mjs';

const original=`use wasmtime::{Config,WasmFeatures};
fn policy(winch: bool) -> Vec<(&'static str, WasmFeatures, bool)> {
 vec![("GC", WasmFeatures::GC, false)]
}
pub fn configure(config: &mut Config, winch: bool) {
 for (_,flag,enabled) in policy(winch) { config.wasm_features(flag,enabled); }
}
pub fn describe(winch: bool) -> Value { json!({
        "namespace": "wasmparser/0.251.0",
}) }
`;
test('core proposals enable GC and native threads while retaining backend and ISA exclusions',()=>{
 const result=withWasmtimeCoreProposals(original);
 for(const [name,value] of [['GC','!winch'],['FUNCTION_REFERENCES','!winch'],['GC_TYPES','true'],['EXCEPTIONS','true'],['LEGACY_EXCEPTIONS','false']])assert(result.includes(`("${name}", WasmFeatures::${name}, ${value})`));
 assert(result.includes('!winch || cfg!(target_arch = "x86_64")'));
 assert(result.includes('!winch && cfg!(all(target_arch = "x86_64", unix))'));
 assert(result.includes('!(winch && cfg!(target_arch = "aarch64"))'));
 assert(result.includes('config.wasm_branch_hinting(!winch)'));
 assert(result.includes('config.gc_support(true)'));assert(result.includes('config.shared_memory(!winch || cfg!(target_arch = "x86_64"))'));
 assert.equal(withWasmtimeCoreProposals(result),result);
 assert(result.includes(WASMTIME_FEATURE_POLICY));
 assert.throws(()=>withWasmtimeCoreProposals('unknown source'),/seam changed/);
});
test('feature crate dependencies include real collectors and thread support, without changing source pins',()=>{
 const manifest='wasmtime = { path = "/pinned/wasmtime", default-features = false, features = ["cranelift", "winch"] }\n';
 const arm=withWasmtimeFeatureCrates(manifest,{architecture:'arm64'}),amd=withWasmtimeFeatureCrates(manifest,{architecture:'x64'});
 for(const feature of ['gc','gc-drc','gc-null','threads'])assert(arm.includes(JSON.stringify(feature)));
 assert(!arm.includes('"gc-copying"'));
 assert(!arm.includes('"stack-switching"'));assert(amd.includes('"stack-switching"'));
 assert(arm.includes('path = "/pinned/wasmtime"'));assert(arm.includes('default-features = false'));
 assert.equal(withWasmtimeFeatureCrates(arm,{architecture:'arm64'}),arm);
 assert.throws(()=>withWasmtimeFeatureCrates('wasmtime = "moving-version"'),/seam changed/);
});
test('repair eligibility excludes proposals the selected backend and ISA cannot execute',()=>{
 assert(wasmtimeProposalsForBackend('wasmtime','arm64').includes('gc'));
 assert(!wasmtimeProposalsForBackend('wasmtime','arm64').includes('stack-switching'));
 assert(wasmtimeProposalsForBackend('wasmtime','amd64').includes('stack-switching'));
 assert(!wasmtimeProposalsForBackend('wasmtime-winch','arm64').includes('threads'));
 assert(wasmtimeProposalsForBackend('wasmtime-winch','amd64').includes('threads'));
 for(const backend of ['wasmtime-winch'])for(const feature of ['gc','typed-function-references','stack-switching','branch-hinting'])assert(!wasmtimeProposalsForBackend(backend,'amd64').includes(feature));
 assert.deepEqual(wasmtimeProposalsForBackend('unrelated','amd64'),[]);
});

 test('branch metadata declarations recognize the qualified feature profile and require configured consumption',async()=>{
 const {runtimeDeclaresFeature}=await import('./lib/feature-support.mjs');
 const d={runtime:'wasmtime',backend:'cranelift',effective_configuration:{validator_feature_policy:WASMTIME_FEATURE_POLICY},validator_features:{branch_hinting:true}};
 assert.equal(runtimeDeclaresFeature(d,'branch-hinting'),true);
 assert.equal(runtimeDeclaresFeature({...d,backend:'winch'},'branch-hinting'),false);
 assert.equal(runtimeDeclaresFeature({...d,validator_features:{branch_hinting:false}},'branch-hinting'),false);
 assert.equal(runtimeDeclaresFeature({...d,effective_configuration:{validator_feature_policy:'unknown'}},'branch-hinting'),false);
 });
