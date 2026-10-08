import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wasmerLLVMVersion} from './lib/llvm-toolchain.mjs';
test('selects the LLVM ABI requested by the actual pinned dependency',()=>{
 assert.deepEqual(wasmerLLVMVersion('features = ["target-all", "llvm22-1-prefer-static"]'),{major:22,minor:1});
 assert.deepEqual(wasmerLLVMVersion('features = ["llvm18-1-force-static"]'),{major:18,minor:1});
 assert.throws(()=>wasmerLLVMVersion('features = []'),/does not identify/);
 assert.throws(()=>wasmerLLVMVersion('features = ["llvm18-1", "llvm22-1"]'),/does not identify/);
});
