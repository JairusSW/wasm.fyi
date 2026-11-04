import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shellNumericSignature,withShellCompoundSignature} from './lib/js-shell-signature.mjs';

test('real source-built GC and continuation kernels expose their scalar benchmark signature',async()=>{
 const root=new URL('../corpora/features/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
 let checked=0;
 for(const workload of manifest.filter(w=>/^features\/(?:gc|stack-switching)\//.test(w.id)&&!w.host_profile)){
  const bytes=new Uint8Array(await readFile(new URL(workload.artifact,root)));
  const signature=shellNumericSignature(bytes,workload.export);
  assert.equal(signature.params.length,workload.args.length,workload.id);
  assert.equal(signature.results.length,workload.oracle.expected.length,workload.id);
  checked++;
 }
 assert(checked>=20);
});
test('compound signature reader still rejects truncated binaries and missing numeric exports',()=>{
 assert.throws(()=>shellNumericSignature(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1]),'benchmark'));
 assert.throws(()=>shellNumericSignature(new Uint8Array([0,97,115,109,1,0,0,0]),'benchmark'));
});
test('adapter migration installs the actual tested reader and is idempotent',()=>{
 const source='before\n  // Read just numeric function signatures; the runtime validates.\n  function numericSignature(){throw Error("non-function type unsupported")}\n  function canonical(value){return value}\nafter';
 const after=withShellCompoundSignature(source);
 assert(after.includes(shellNumericSignature.toString()));
 assert.equal(withShellCompoundSignature(after),after);
 assert(!after.includes('non-function type unsupported'));
});
