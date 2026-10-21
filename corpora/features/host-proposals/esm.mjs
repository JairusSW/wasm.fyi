// Native ESM loader checks. No Wasm loader or JS export polyfills.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [name,path,iterations='1']=process.argv.slice(2);
const source=path.startsWith('file:')?new URL(path):pathToFileURL(resolve(path));
for(let invocation=0;invocation<Number(iterations);invocation++) {
source.searchParams.set('invocation',String(invocation));
if(name==='source-phase') {
 const module=await import.source(source.href);
 assert.ok(module instanceof WebAssembly.Module);
 assert.equal(new WebAssembly.Instance(module).exports.value(),7);
} else {
 const exports=await import(source.href);
 if(name==='named-function')assert.equal(exports.value(),7);
 else if(name==='immutable-global')assert.equal(exports.value,42);
 else if(name==='memory-segment')assert.deepEqual([...new Uint8Array(exports.memory.buffer,0,4)],[0,127,128,255]);
 else if(name==='host-import')assert.equal(exports.benchmark(9),28);
 else throw Error('Unknown ESM case');
}
}
console.log(JSON.stringify({case:name,status:'verified'}));
