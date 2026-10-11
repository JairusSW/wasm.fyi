import test from 'node:test';
import assert from 'node:assert/strict';
import {describedV8Binding} from './lib/v8-binding-policy.mjs';
test('plan without description binds actual describe metadata and retains launch identity',()=>{
 const plan={id:'v8',command:['/sdk/node','--turboshaft-wasm'],file_sha256:{'/sdk/node':'sealed'}};
 const actual={description:{backend:'turboshaft',effective_configuration:{wasm_compiler_policy:'explicit-flag'}}};
 const result=describedV8Binding(plan,actual,'explicit-flag');
 assert.deepEqual(result.command,plan.command);assert.deepEqual(result.file_sha256,plan.file_sha256);assert.deepEqual(result.description,actual.description);assert.equal(plan.description,undefined);
 for(const metadata of [{},{description:{backend:'optimizing-only',effective_configuration:{wasm_compiler_policy:'explicit-flag'}}},{description:{backend:'turboshaft',effective_configuration:{wasm_compiler_policy:'mandatory-source-default'}}}])assert.throws(()=>describedV8Binding(plan,metadata,'explicit-flag'));
});
