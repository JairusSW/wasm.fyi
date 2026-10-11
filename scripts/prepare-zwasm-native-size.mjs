import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const source=resolve(process.argv[2]);
const path=join(source,'src/api/zwasm_ext.zig');
const text=await readFile(path,'utf8');
if(!text.includes('pub export fn zwasm_instance_engine(')||!text.includes('capi.jitOf('))throw Error('Pinned Zwasm C API anchors changed');
const runner=await readFile(join(source,'src/engine/runner.zig'),'utf8');
if(!runner.includes('compiled: CompiledWasm,')||!runner.includes('owned: setup_mod.RuntimeOwned,'))throw Error('Pinned Zwasm native image anchors changed');
if(!text.includes('pub export fn wasmfyi_zwasm_native_code_size('))await writeFile(path,text+`
// Introspection only: complete module executable allocation and instance-owned
// import thunks. Shared runtime code and non-executable metadata are excluded.
pub export fn wasmfyi_zwasm_native_code_size(i: ?*const Instance, out: ?*usize) callconv(.c) bool {
    const inst = i orelse return false;
    const jit = capi.jitOf(@constCast(inst)) orelse return false;
    const result = out orelse return false;
    result.* = jit.compiled.module.block.bytes.len;
    if (jit.owned.thunk_arena) |arena| result.* += arena.bytes.len;
    return true;
}
`);
console.log('Installed Zwasm module native-image extent getter');
