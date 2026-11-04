import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wasmEdgeHostLinkFlags} from './lib/wasmedge-sdk.mjs';

test('optional ELF version labels never relax actual unresolved imports',()=>{
 const flags=wasmEdgeHostLinkFlags({},'linux').join(' ');
 assert.match(flags,/--undefined-version/);assert.match(flags,/--no-undefined/);
 assert.doesNotMatch(flags,/allow-shlib-undefined|unresolved-symbols|ignore-all/);
 assert.deepEqual(wasmEdgeHostLinkFlags({},'darwin'),[]);
});
test('LLVM SDK uses the explicit compatible C++ ABI and no duplicate standard headers',()=>{
 const flags=wasmEdgeHostLinkFlags({WASMFYI_WAVM_CXX_SDK:'/cache/compatible'},'linux').join(' ');
 assert.match(flags,/clang\+\+/);assert.match(flags,/-stdlib=libc\+\+ -nostdinc\+\+/);assert.match(flags,/-L\/cache\/compatible\/lib/);
 assert.match(flags,/CMAKE_EXE_LINKER_FLAGS=.*-L\/cache\/compatible\/lib/);
 assert.match(flags,/--no-undefined/);
 const system=wasmEdgeHostLinkFlags({WASMFYI_WASMEDGE_SYSTEM_CXX:'1',WASMFYI_WAVM_CXX_SDK:'/cache/compatible'},'linux');
 assert.doesNotMatch(system.join(' '),/cache\/compatible/);
 assert.ok(system.includes('-DCMAKE_C_COMPILER=/usr/bin/cc'));
 assert.ok(system.includes('-DCMAKE_CXX_COMPILER=/usr/bin/c++'));
 assert.ok(system.includes('-DCMAKE_CXX_FLAGS='));
 for(const key of ['CMAKE_AR','CMAKE_C_COMPILER_AR','CMAKE_CXX_COMPILER_AR'])assert.ok(system.includes('-D'+key+'=/usr/bin/gcc-ar'));
 for(const key of ['CMAKE_RANLIB','CMAKE_C_COMPILER_RANLIB','CMAKE_CXX_COMPILER_RANLIB'])assert.ok(system.includes('-D'+key+'=/usr/bin/gcc-ranlib'));
 assert.throws(()=>wasmEdgeHostLinkFlags({WASMFYI_WASMEDGE_CXX_SDK:'/cache/unsafe prefix'},'linux'),/Unsafe/);
});
