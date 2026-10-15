import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkV8 } from './lib/v8-corpus.mjs';
import { site, digest } from './lib/wasmbench.mjs';
import { kernels, reference } from './lib/application-kernels.mjs';
const manifest=JSON.parse(await readFile(join(site,'corpora/features/manifest.json')));
const fixture=id=>{const w=manifest.find(w=>w.id===id);assert(w,'Missing active feature fixture: '+id);return {...w,artifact:join(site,'corpora/features',w.artifact)};};

test('V8 checks artifact digests and exact oracles against an active core fixture',async()=>{
  const w=fixture('features/core-num/integer-multiply-add/64');
  await assert.rejects(checkV8({...w,sha256:'0'.repeat(64)}),/digest mismatch/);
  await assert.rejects(checkV8({...w,oracle:{...w.oracle,expected:['999999999']}},{repeat:1}),/Incorrect result/);
  assert.equal((await checkV8(w,{repeat:1})).status,'verified');
});

test('shared-memory identity imports match active contracts and reject wrong callbacks',async()=>{
  for(const name of ['host-identity','host-opaque-identity']){
    const w=fixture('features/threads/'+name+'/64');
    assert.equal((await checkV8(w,{repeat:1})).status,'verified');
    await assert.rejects(checkV8(w,{repeat:1,mutateImports:imports=>{imports.wasmbench.identity=()=>0;}}),/Incorrect result/);
  }
});

test('JSPI contracts execute awaited imports and verify every returned result',async()=>{
  for(const name of ['suspend-every-call','suspend-alternate','two-imports','state-across-suspension','immediate-resolve']){
    const w=fixture('features/jspi/'+name+'/64');
    assert.equal((await checkV8(w,{repeat:1})).status,'verified',name);
  }
  await assert.rejects(checkV8(fixture('features/jspi/suspend-every-call/64'),{repeat:1,mutateImports:imports=>{imports.jspi.step=new WebAssembly.Suspending(async()=>0);}}),/Incorrect result/);
});

test('portable DNA and text kernels match independent references at different inputs',async()=>{
  const apps=JSON.parse(await readFile(join(site,'corpora/applications/manifest.json')));
  for(const kernel of kernels.filter(k=>k.kind>=97)) {
    const w=apps.find(w=>w.id===`applications/${kernel.id}`);
    const bytes=await readFile(join(site,'corpora/applications',w.artifact));assert.equal(digest(bytes),w.sha256);
    const instance=await WebAssembly.instantiate(await WebAssembly.compile(bytes));
    for(const size of kernel.kind<=99?[1,2,17,64,256]:[5,17,256,4096])for(let repeat=0;repeat<3;repeat++)
      assert.equal(instance.exports.benchmark(size)>>>0,reference(kernel.kind,size),`${kernel.id}/${size}`);
  }
});
