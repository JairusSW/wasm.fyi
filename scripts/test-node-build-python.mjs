import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nodeBuildPython,nodeBuildEnvironment} from './lib/node-build-python.mjs';

test('pinned compatible Python is selected for source configuration',async()=>{
 const selected=await nodeBuildPython({WASMFYI_BUILD_PYTHON:'/cache/python-3.12.10/bin/python3.12'},async(program,args)=>{
  assert.equal(program,'/cache/python-3.12.10/bin/python3.12');assert.equal(args[0],'-c');return {output:'3.12.10\n'};
 });
 assert.deepEqual(selected,{program:'/cache/python-3.12.10/bin/python3.12',version:'3.12.10'});
});
test('old Python fails closed before SDK configure scripts run',async()=>{
 for(const engine of ['Node','SpiderMonkey','JavaScriptCore'])await assert.rejects(nodeBuildPython({},async()=>({output:'3.8.10'}),engine),new RegExp(engine+' source configure requires Python >=3.10'));
});
test('compatible native compiler paths and library search are explicit and build-only',()=>{
 const original={WASMFYI_WAVM_CXX_SDK:'/cache/llvm20-compatible',CXXFLAGS:'-O2'};
 const selected=nodeBuildEnvironment(original,'linux');
 assert.equal(selected.CXX,'/cache/llvm20-compatible/bin/clang++');
 assert.match(selected.CXXFLAGS,/-stdlib=libc\+\+/);assert.match(selected.LDFLAGS,/-L\/cache\/llvm20-compatible\/lib/);
 assert.match(selected.LDFLAGS,/-stdlib=libc\+\+/);
 assert.equal(original.CXX,undefined);assert.equal(original.CXXFLAGS,'-O2');
 assert.throws(()=>nodeBuildEnvironment({WASMFYI_NODE_CXX_SDK:'/cache/unsafe prefix'},'linux'),/Unsafe/);
});
test('non-Linux Node builds preserve native tools when a WAVM SDK is also configured',()=>{
 const env={WASMFYI_WAVM_CXX_SDK:'/opt/homebrew/opt/llvm@20',CC:'/opt/homebrew/opt/llvm/bin/clang',CXX:'/opt/homebrew/opt/llvm/bin/clang++',LDFLAGS:'-Wl,-dead_strip'};
 for(const platform of ['darwin','win32'])assert.deepEqual(nodeBuildEnvironment(env,platform),env);
});
