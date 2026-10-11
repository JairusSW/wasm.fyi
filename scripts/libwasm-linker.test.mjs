import test from 'node:test';
import assert from 'node:assert/strict';
import {libwasmLinkerEnvironment} from './lib/libwasm-linker.mjs';

test('private Libwasm source and Rust adapter use the same sysroot driver without changing global environment',()=>{
 const env={WASMFYI_LIBWASM_CC:'/private/bin/clang22',RUSTFLAGS:'existing rust policy',CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER:'/usr/bin/cc'};
 const configured=libwasmLinkerEnvironment(env,'linux','x64');
 assert.equal(configured.CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER,env.WASMFYI_LIBWASM_CC);
 assert.equal(configured.RUSTFLAGS,env.RUSTFLAGS);
 assert.equal(env.CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER,'/usr/bin/cc');
 assert.equal(libwasmLinkerEnvironment(env,'linux','arm64').CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER,env.WASMFYI_LIBWASM_CC);
});
test('ordinary and Darwin builds preserve existing linker selection; invalid private driver fails before build',()=>{
 const ordinary={CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER:'/usr/bin/cc'};
 assert.deepEqual(libwasmLinkerEnvironment(ordinary,'linux','x64'),ordinary);
 const darwin={WASMFYI_LIBWASM_CC:'/private/bin/clang22'};
 assert.deepEqual(libwasmLinkerEnvironment(darwin,'darwin','arm64'),darwin);
 assert.throws(()=>libwasmLinkerEnvironment({WASMFYI_LIBWASM_CC:'clang22'},'linux','x64'),/absolute path/);
});
