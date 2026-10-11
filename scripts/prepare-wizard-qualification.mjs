import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

// Adds native host callbacks used by the linked oracle driver. Original guest
// artifacts are unchanged. This SDK is for execution proof, not phase timing.
const root=resolve(process.argv[2]);
const file=join(root,'src/WasmMode.v3');
let source=await readFile(file,'utf8');
const marker='HostModuleBuilder.new("wasmfyi-qualification")';
if(!source.includes(marker)){
 const anchor='WizengModes.runWasm = run;';
 if(!source.includes(anchor))throw Error('Pinned Wizard source lacks qualification insertion point');
 source=source.replace(anchor,anchor+`
        HostModuleBuilder.new("wasmbench")
            .func_i_i("identity", fun (context: void) => WasmQualification.identity).register(true);
        HostModuleBuilder.new("env")
            .func_uuuu_rv("abort", fun (context: void) => WasmQualification.abort).register(true);
        HostModuleBuilder.new("wasmfyi-qualification")
            .func_i_v("word", fun (context: void) => WasmQualification.word)
            .func_v_v("verified", fun (context: void) => WasmQualification.verified).register(true);
 `);
 await writeFile(file,source);
}
await writeFile(join(root,'src/util/WasmQualification.v3'),`// Actual values are forwarded to the independent host oracle.
component WasmQualification {
 def identity(value: int) -> int { return value; }
 def abort(a: u32, b: u32, c: u32, d: u32) -> HostResult { return HostResult.Throw(Trap.new(TrapReason.ERROR, "AssemblyScript abort", null)); }
 def verified() { System.puts("WIZARD_QUALIFIED\\n"); }
 def word(value: int) { System.puts("WIZARD_WORD "); System.puti(value); System.puts("\\n"); }
}
`);
