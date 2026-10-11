// Expose the existing native compiler as a module-owned, reference-counted image.
// Instance setup uses the SDK's original linker and host binding machinery.
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]);
const runnerPath=join(root,'src/engine/runner.zig'),apiPath=join(root,'src/api/instance.zig');
let runner=await readFile(runnerPath,'utf8'),api=await readFile(apiPath,'utf8');
function patch(text,old,next){if(!text.includes(old))throw Error('Pinned Zwasm compile-cache seam changed: '+old);return text.replace(old,next);}
if(!runner.includes('pub const WasmfyiSharedCompiled = struct')){
 runner=patch(runner,'pub const JitInstance = struct {',`pub const WasmfyiSharedCompiled = struct {
    compiled: CompiledWasm,
    references: usize = 1,
    pub fn release(self: *WasmfyiSharedCompiled, allocator: Allocator) void {
        std.debug.assert(self.references > 0);
        self.references -= 1;
        if (self.references == 0) {
            self.compiled.deinit(allocator);
            allocator.destroy(self);
        }
    }
};
pub const JitInstance = struct {
    wasmfyi_shared: ?*WasmfyiSharedCompiled = null,`);
 const start=runner.indexOf('pub const JitInstance = struct {');
 runner=runner.slice(0,start)+patch(runner.slice(start),'        self.compiled.deinit(allocator);','        if (self.wasmfyi_shared) |shared| shared.release(allocator) else self.compiled.deinit(allocator);');
 runner=patch(runner,'    pub fn fromCompiled(allocator: Allocator, compiled: CompiledWasm, wasm_bytes: []const u8) Error!JitInstance {',`    pub fn wasmfyiFromSharedLinked(
        allocator: Allocator, shared: *WasmfyiSharedCompiled, wasm_bytes: []const u8,
        imported_global_vals: []const u64, func_import_targets: []const setup_mod.FuncImportTarget,
        tag_import_targets: []const setup_mod.TagImportTarget, host_func_targets: []const setup_mod.HostFuncTarget,
    ) Error!JitInstance {
        var owned = try setup_mod.setupRuntimeLinked(allocator, &shared.compiled, wasm_bytes, imported_global_vals, func_import_targets, tag_import_targets, host_func_targets);
        errdefer owned.deinit(allocator);
        const targets = try allocator.dupe(setup_mod.FuncImportTarget, func_import_targets);
        shared.references += 1;
        return .{ .compiled = shared.compiled, .owned = owned, .wasm_bytes = wasm_bytes, .import_targets = targets, .wasmfyi_shared = shared };
    }
    pub fn fromCompiled(allocator: Allocator, compiled: CompiledWasm, wasm_bytes: []const u8) Error!JitInstance {`);
}
if(!api.includes('wasmfyi_compiled: ?*runner.WasmfyiSharedCompiled')){
 api=patch(api,'    jit_borrowers: u32 = 0,','    jit_borrowers: u32 = 0,\n    wasmfyi_compiled: ?*runner.WasmfyiSharedCompiled = null,');
 api=patch(api,'    if (handle.ref_view) |rv| alloc.destroy(rv); // object-identity as_ref view (ADR-0158)','    if (handle.wasmfyi_compiled) |compiled| compiled.release(alloc);\n    handle.wasmfyi_compiled = null;\n    if (handle.ref_view) |rv| alloc.destroy(rv); // object-identity as_ref view (ADR-0158)');
 api=patch(api,'jit.* = runner.JitInstance.initLinked(alloc, bytes, &.{}, func_imports.cross, &.{}, func_imports.host) catch |err| {',`jit.* = (if (module.wasmfyi_compiled) |shared|
        runner.JitInstance.wasmfyiFromSharedLinked(alloc, shared, bytes, &.{}, func_imports.cross, &.{}, func_imports.host)
        else runner.JitInstance.initLinked(alloc, bytes, &.{}, func_imports.cross, &.{}, func_imports.host)) catch |err| {`);
 api+=`
// Null means success; failures return an SDK-owned static error-name string.
pub export fn wasmfyi_zwasm_compile_module(value: ?*Module) callconv(.c) ?[*:0]const u8 {
    const module = value orelse return "NullModule";
    if (module.wasmfyi_compiled != null) return null;
    const store = module.store orelse return "NullStore";
    const allocator = storeAllocator(store) orelse return "NullAllocator";
    const data = module.bytes_ptr orelse return "NullBytes";
    const shared = allocator.create(runner.WasmfyiSharedCompiled) catch return "OutOfMemory";
    const compiled = runner.compileWasm(allocator, data[0..module.bytes_len]) catch |err| {
        allocator.destroy(shared);
        return @errorName(err).ptr;
    };
    shared.* = .{ .compiled = compiled };
    module.wasmfyi_compiled = shared;
    return null;
}
`;
}
await writeFile(runnerPath,runner);await writeFile(apiPath,api);
console.log('Installed Zwasm module-owned native compilation cache');
