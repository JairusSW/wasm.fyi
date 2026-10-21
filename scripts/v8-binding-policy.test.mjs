import test from 'node:test';
import assert from 'node:assert/strict';
import {describedV8Binding,currentV8BindingPolicy} from './lib/v8-binding-policy.mjs';
import {V8_FEATURE_FLAG_POLICY} from './lib/v8-feature-flags.mjs';
test('plan without description binds actual describe metadata and retains launch identity',()=>{
 const plan={id:'v8',command:['/sdk/node','--turboshaft-wasm'],file_sha256:{'/sdk/node':'sealed'}};
 const actual={description:{backend:'turboshaft',effective_configuration:{wasm_compiler_policy:'explicit-flag'}}};
 const result=describedV8Binding(plan,actual,'explicit-flag');
 assert.deepEqual(result.command,plan.command);assert.deepEqual(result.file_sha256,plan.file_sha256);assert.deepEqual(result.description,actual.description);assert.equal(plan.description,undefined);
 for(const metadata of [{},{description:{backend:'optimizing-only',effective_configuration:{wasm_compiler_policy:'explicit-flag'}}},{description:{backend:'turboshaft',effective_configuration:{wasm_compiler_policy:'mandatory-source-default'}}}])assert.throws(()=>describedV8Binding(plan,metadata,'explicit-flag'));
});
test('feature bindings require the exact versioned proposal flag policy',()=>{
 const receipt={runtime:{description:{backend:'turboshaft'}},env:{WASMBENCH_V8_TURBOSHAFT_POLICY:'mandatory-source-default',WASMBENCH_V8_CACHE_DISABLE_FLAG:'--no-wasm-native-module-cache'},provenance:{featureJspiAdapter:true,featureFreshSampling:true,featureCoverageAdapter:true,featureBigIntBinding:true,featureProposalFlags:V8_FEATURE_FLAG_POLICY}};
 assert.equal(currentV8BindingPolicy(receipt,{featureJspi:true}),true);
 assert.equal(currentV8BindingPolicy({...receipt,provenance:{...receipt.provenance,featureProposalFlags:true}},{featureJspi:true}),false);
 assert.equal(currentV8BindingPolicy({...receipt,provenance:{...receipt.provenance,featureProposalFlags:'workload-scoped-v1'}},{featureJspi:true}),false);
 assert.equal(currentV8BindingPolicy({...receipt,provenance:{}},{featureJspi:false}),true);
});
