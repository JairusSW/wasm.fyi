import {readFile,writeFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {wazyNativeSizeLayout} from './lib/wazy-native-size.mjs';
const root=resolve(process.argv[2]);
const exists=async path=>Boolean(await stat(join(root,path)).catch(()=>null));
const candidates=['internal/engine/native/engine.go','internal/engine/wazevo/engine.go'];
const layout=wazyNativeSizeLayout(new Set((await Promise.all(candidates.map(async path=>[path,await exists(path)]))).filter(([,ok])=>ok).map(([path])=>path)));
if(layout==='unavailable-wazevo'){
 console.log(JSON.stringify({status:'unavailable',reason:'Pinned Wazy Wazevo layout has no qualified module-owned native-size getter'}));
 process.exit(0);
}
const engine=await readFile(join(root,'internal/engine/native/engine.go'),'utf8');
const config=await readFile(join(root,'config.go'),'utf8');
if(!/entryPreambles\s+\[\]byte/.test(engine)||!config.includes('compiledEngine wasm.Engine'))throw Error('Pinned Wazy native-size API anchors changed');
await writeFile(join(root,'internal/engine/native/wasmfyi_native_size.go'),`package native
import "github.com/samyfodil/wazy/internal/wasm"
// Compiled module image includes function code/data/alignment and module entry
// stubs. Shared runtime trampolines and non-executable metadata are excluded.
func(e *engine) WasmFyiNativeCodeSize(id wasm.ModuleID)(uint64,bool){
 e.mux.RLock();defer e.mux.RUnlock()
 module,ok:=e.compiledModules[id];if !ok||module==nil||module.executables==nil{return 0,false}
 return uint64(len(module.executable))+uint64(len(module.entryPreambles)),true
}
`);
await writeFile(join(root,'wasmfyi_native_size.go'),`package wazy
import "github.com/samyfodil/wazy/internal/wasm"
func(c *compiledModule) WasmFyiNativeCodeSize()(uint64,bool){
 if native,ok:=c.compiledEngine.(interface{WasmFyiNativeCodeSize(wasm.ModuleID)(uint64,bool)});ok{return native.WasmFyiNativeCodeSize(c.module.ID)}
 return 0,false
}
`);
