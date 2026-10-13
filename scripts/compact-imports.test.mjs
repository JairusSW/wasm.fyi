import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compactImportFixtures} from '../corpora/features/compact-imports.mjs';
const name=s=>[s.length,...Buffer.from(s)];
function importSection(bytes){
 let offset=8;
 const leb=()=>{let n=0,shift=0,b;do{b=bytes[offset++];n|=(b&127)<<shift;shift+=7;}while(b&128);return n;};
 while(offset<bytes.length){const id=bytes[offset++],size=leb(),start=offset;offset+=size;if(id===2)return [...bytes.subarray(start,offset)];}
 throw Error('Missing import section');
}
test('source-built fixtures retain both actual compact wire encodings',async()=>{
 const entries=Array.from({length:8},()=>[...name('identity'),0,0]).flat();
 const fields=Array.from({length:8},()=>name('identity')).flat();
 const expected={
  'module-group':[1,...name('wasmbench'),0,0x7f,8,...entries],
  'type-group':[1,...name('wasmbench'),0,0x7e,0,0,8,...fields],
  'ordinary-baseline':[8,...Array.from({length:8},()=>[...name('wasmbench'),...name('identity'),0,0]).flat()]
 };
 for(const f of compactImportFixtures()){
  const bytes=await readFile(new URL('../corpora/features/artifacts/compact-imports-'+f.name+'.wasm',import.meta.url));
  assert.deepEqual(importSection(bytes),expected[f.name]);
 }
});
test('compact import checksums match independent per-call arithmetic',()=>{
 for(const f of compactImportFixtures())for(const n of [1,64,4096]){
  let sum=0;for(let i=0;i<n;i++)sum=(sum+i+(i+3))>>>0;assert.equal(f.expected(n),sum);
 }
});
test('ordinary control executes first and last of all eight imports',async()=>{
 const bytes=await readFile(new URL('../corpora/features/artifacts/compact-imports-ordinary-baseline.wasm',import.meta.url));
 const module=await WebAssembly.compile(bytes);assert.equal(WebAssembly.Module.imports(module).length,8);
 const instance=await WebAssembly.instantiate(module,{wasmbench:{identity:x=>x}});
 for(const n of [1,64,4096])assert.equal(instance.exports.benchmark(n)>>>0,n*(n+2));
});
