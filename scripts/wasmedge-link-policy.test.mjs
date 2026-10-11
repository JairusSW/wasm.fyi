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
 assert.match(flags,/--no-undefined/);
 assert.throws(()=>wasmEdgeHostLinkFlags({WASMFYI_WASMEDGE_CXX_SDK:'/cache/unsafe prefix'},'linux'),/Unsafe/);
});
