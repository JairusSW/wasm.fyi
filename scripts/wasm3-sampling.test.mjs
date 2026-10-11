import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {wasm3SamplingSource} from './lib/wasm3-sampling.mjs';
const sourcePath=process.env.WASMFYI_NATIVE_ADAPTER_SOURCE;
const original=sourcePath?await readFile(sourcePath,'utf8'):`
(operations == 1 && !cfg!(feature = "wasm3"))
let mut local = if cfg!(feature = "wasm3") && scenario == "first-call" {
 Some(engine.compile(&self.bytes)?)
};
if let Some(target) = steady.as_mut() {
 verify(target, w, &result)?;
                }
                let stages = [];
let start = Instant::now();
// wasm3 recompiles outside first-call timing
`;
test('source-bound wasm3 prepares fresh modules before steady execution and removes hidden priming',()=>{
 assert(original.includes('(operations == 1 && !cfg!(feature = "wasm3"))'));
 const patched=wasm3SamplingSource(original);
 assert(patched.includes('scenario == "steady" && w["reset"] == "fresh_instance_per_sample"'));
 assert(!patched.includes('(operations == 1 && !cfg!(feature = "wasm3"))'));
 assert(patched.indexOf('Some(engine.compile(&self.bytes)?)',patched.indexOf('// wasmfyi wasm3'))<patched.indexOf('let start = Instant::now();',patched.indexOf('// wasmfyi wasm3')));
 assert(patched.includes('if !cfg!(feature = "wasm3") { if let Some(target) = steady.as_mut() {'));
 assert.equal(wasm3SamplingSource(patched),patched);
});
test('changed native contracts fail closed',()=>{
 assert.throws(()=>wasm3SamplingSource(original.replace('(operations == 1 && !cfg!(feature = "wasm3"))','other_guard')),/source contract changed/);
});
