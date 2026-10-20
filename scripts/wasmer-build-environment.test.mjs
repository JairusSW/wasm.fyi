import test from 'node:test';import assert from 'node:assert/strict';import {wasmerBuildEnvironment} from './lib/wasmer-build-environment.mjs';
test('Linux Wasmer uses only its explicitly selected C compiler pair',()=>{
 const env={CC:'/old/cc',CXX:'/old/c++',WASMFYI_WASMER_CC:'/qualified/clang',WASMFYI_WASMER_CXX:'/qualified/clang++'};
 const selected=wasmerBuildEnvironment(env,'linux');assert.equal(selected.CC,'/qualified/clang');assert.equal(selected.CXX,'/qualified/clang++');assert.equal(selected.HOST_CC,selected.CC);assert.equal(selected.HOST_CXX,selected.CXX);assert.equal(env.CC,'/old/cc');assert.deepEqual(wasmerBuildEnvironment(env,'darwin'),env);
});
test('partial or unsafe Wasmer compiler selection fails closed',()=>{
 assert.throws(()=>wasmerBuildEnvironment({WASMFYI_WASMER_CC:'/clang'},'linux'),/WASMFYI_WASMER_CXX/);assert.throws(()=>wasmerBuildEnvironment({WASMFYI_WASMER_CC:'clang',WASMFYI_WASMER_CXX:'/clang++'},'linux'),/Unsafe/);assert.deepEqual(wasmerBuildEnvironment({},'linux'),{});
});
