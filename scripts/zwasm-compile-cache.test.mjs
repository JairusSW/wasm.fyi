import test from 'node:test';
import assert from 'node:assert/strict';
import {withZwasmCompileCache} from './prepare-zwasm-compile-cache.mjs';
function fixture(borrowed){
 return {
  runner:`pub const JitInstance = struct {
${borrowed?'    compiled_borrowed: bool = false,':''}
    pub fn deinit() void {
        ${borrowed?'if (!self.compiled_borrowed) ':''}self.compiled.deinit(allocator);
    }
    pub fn fromCompiled(allocator: Allocator, compiled: CompiledWasm, wasm_bytes: []const u8) Error!JitInstance {
    }
};`,
  api:`    jit_borrowers: u32 = 0,
${borrowed?'    shared_jit: ?*const anyopaque = null,':''}
    if (handle.ref_view) |rv| alloc.destroy(rv); // object-identity as_ref view (ADR-0158)
${borrowed?"    // #426 — the instance's address is final":"jit.* = runner.JitInstance.initLinked(alloc, bytes, &.{}, func_imports.cross, &.{}, func_imports.host) catch |err| {"}
`,
 };
}
for(const borrowed of [false,true])test(`Zwasm compiled-cache ownership preserves ${borrowed?'upstream borrowed':'historical owned'} image lifecycle`,()=>{
 const source=fixture(borrowed),patched=withZwasmCompileCache(source.runner,source.api);
 assert(patched.runner.includes('shared.release(allocator)'));
 assert(patched.api.includes('compiled.release(alloc)'));assert(patched.api.includes('module.wasmfyi_compiled = shared'));
 if(borrowed){
  assert(patched.runner.includes('else if (!self.compiled_borrowed) self.compiled.deinit(allocator)'));
  assert(patched.api.includes('module.shared_jit = @ptrCast(&shared.compiled)'));
  assert(patched.api.includes('shared.references += 1'));assert(patched.api.includes('jit.wasmfyi_shared = shared'));
  assert(!patched.runner.includes('wasmfyiFromSharedLinked'));
 }else assert(patched.runner.includes('wasmfyiFromSharedLinked'));
 assert.deepEqual(withZwasmCompileCache(patched.runner,patched.api),patched);
});
test('unknown Zwasm cache ownership seams fail instead of dropping cleanup',()=>{
 const source=fixture(true);
 assert.throws(()=>withZwasmCompileCache(source.runner.replace('if (!self.compiled_borrowed)','if (!other_owner)'),source.api),/seam changed/);
 assert.throws(()=>withZwasmCompileCache(source.runner,source.api.replace('// #426','// changed')),/seam changed/);
});
