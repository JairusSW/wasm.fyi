import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
// Wasm3 compiled modules own their runtime, so a fresh instance needs a fresh
// module. Prepare it before the steady timer; never reuse mutable guest state.
export function wasm3SamplingSource(source){
 if(source.includes('// wasmfyi wasm3 fresh steady samples v1'))return source;
 const edits=[
  ['(operations == 1 && !cfg!(feature = "wasm3"))','operations == 1'],
  ['let mut local = if cfg!(feature = "wasm3") && scenario == "first-call" {','// wasmfyi wasm3 fresh steady samples v1\n                    let mut local = if cfg!(feature = "wasm3") && (scenario == "first-call" || (scenario == "steady" && w["reset"] == "fresh_instance_per_sample")) {'],
  ['if let Some(target) = steady.as_mut() {','if !cfg!(feature = "wasm3") { if let Some(target) = steady.as_mut() {'],
  ['verify(target, w, &result)?;\n                }\n                let stages =','verify(target, w, &result)?;\n                }}\n                let stages ='],
  ['wasm3 recompiles outside first-call timing','wasm3 prepares fresh runtime-bound modules outside first-call and fresh steady timing; no unrecorded steady priming']
 ];
 for(const [before,after] of edits){
  if(source.split(before).length!==2)throw Error('Wasm3 sampling source contract changed: '+before);
  source=source.replace(before,after);
 }
 return source;
}
export async function applyWasm3Sampling(root){
 const path=join(root,'adapters/native/src/main.rs');
 await writeFile(path,wasm3SamplingSource(await readFile(path,'utf8')));
}
