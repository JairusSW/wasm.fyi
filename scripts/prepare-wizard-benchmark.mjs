import {wizardGlobalPolicyDescription} from './lib/wizard-spc-globals.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {wizardJSONParser} from './lib/wizard-json.mjs';
const [sourceArg,virgilArg,revision,targetArg]=process.argv.slice(2);
if(!sourceArg||!virgilArg||!/^[a-f0-9]{40}$/i.test(revision||''))throw Error('Pinned Wizard/Virgil source paths and full Wizard commit required');
const source=resolve(sourceArg),virgil=resolve(virgilArg);
for(const name of ['WasmBenchCore.v3','WasmBenchOracle.v3','WasmBenchPrepared.v3','WasmBenchRPC.v3']){
 let text=await readFile(fileURLToPath(new URL('../adapters/qualification/wizard/'+name,import.meta.url)),'utf8');
 if(name==='WasmBenchRPC.v3')text=wizardGlobalPolicyDescription(text);
 if(name==='WasmBenchRPC.v3')text=text.replaceAll('399357ce20b8330ddc1888a93cceb0d4cf3762de',revision);
 await writeFile(join(source,'src/util',name),text);
}
const target=targetArg||'portable';
if(!['portable','linux-x64'].includes(target))throw Error('Unknown Wizard clock target');
await writeFile(join(source,'src/util/WasmBenchClock.v3'),await readFile(fileURLToPath(new URL('../adapters/qualification/wizard/'+(target==='linux-x64'?'WasmBenchClockLinux.v3':'WasmBenchClockPortable.v3'),import.meta.url))));
const json=await readFile(join(virgil,'lib/file/json/JsonParser.v3'),'utf8');
await writeFile(join(source,'src/util/WasmBenchJson.v3'),wizardJSONParser(json));
const execute=join(source,'src/engine/Execute.v3');let text=await readFile(execute,'utf8');
if(!text.includes('def wasmfyiMode()')){
 if(!text.includes('component ExecuteOptions {'))throw Error('Wizard strategy registry API changed');
 text=text.replace('component ExecuteOptions {',`component ExecuteOptions {
    def wasmfyiMode() -> string {
        for (l = modes; l != null; l = l.tail) if (l.head.1 == Execute.tiering) return l.head.0;
        return "unknown";
    }
 `);await writeFile(execute,text);
}
const mode=join(source,'src/WasmMode.v3');text=await readFile(mode,'utf8');
if(!text.includes('WasmfyiWizardRPC.loop(engine)')){
 const anchor='def run(engine: Engine, monitors: Range<Monitor>, wasm: Range<string>, args: Array<string>) -> int {';
 if(!text.includes(anchor))throw Error('Wizard SDK entrypoint API changed');
 text=text.replace(anchor,anchor+'\n        if (Strings.equal(WizengOptions.ENTRYPOINT.val, "wasmfyi-bench")) return WasmfyiWizardRPC.loop(engine);');
 await writeFile(mode,text);
}

// Register the corpus's actual host imports on fresh pinned SDK checkouts.
// No guest rewriting or external per-invocation subprocess is involved.
text=await readFile(mode,'utf8');
if(!text.includes('WasmfyiWizardHost.identity')){
 const anchor='WizengModes.runWasm = run;';
 if(!text.includes(anchor))throw Error('Wizard SDK host registration API changed');
 text=text.replace(anchor,anchor+`
        HostModuleBuilder.new("wasmbench")
            .func_i_i("identity", fun (context: void) => WasmfyiWizardHost.identity).register(true);
        HostModuleBuilder.new("env")
            .func_uuuu_rv("abort", fun (context: void) => WasmfyiWizardHost.abort).register(true);
 `);
 await writeFile(mode,text);
}
await writeFile(join(source,'src/util/WasmBenchHost.v3'),`component WasmfyiWizardHost {
    def identity(value: int) -> int { return value; }
    def abort(a: u32, b: u32, c: u32, d: u32) -> HostResult {
        return HostResult.Throw(Trap.new(TrapReason.ERROR, "AssemblyScript abort", null));
    }
}
`);
