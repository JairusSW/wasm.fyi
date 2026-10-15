import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compactImportFixtures} from '../corpora/features/compact-imports.mjs';
const leb=n=>{const out=[];do{const b=n&127;n=Math.floor(n/128);out.push(b|(n?128:0));}while(n);return out;};
const name=s=>[...leb(Buffer.byteLength(s)),...Buffer.from(s)];
function importSection(bytes){
 let offset=8;
 const leb=()=>{let n=0,shift=0,b;do{b=bytes[offset++];n|=(b&127)<<shift;shift+=7;}while(b&128);return n;};
 while(offset<bytes.length){const id=bytes[offset++],size=leb(),start=offset;offset+=size;if(id===2)return [...bytes.subarray(start,offset)];}
 throw Error('Missing import section');
}
test('source-built fixtures retain both actual compact wire encodings',async()=>{
 const ordinary=count=>[...leb(count),...Array.from({length:count},()=>[...name('wasmbench'),...name('identity'),0,0]).flat()];
 const moduleGroup=count=>[...name('wasmbench'),0,0x7f,...leb(count),...Array.from({length:count},()=>[...name('identity'),0,0]).flat()];
 const typeGroup=count=>[...name('wasmbench'),0,0x7e,0,0,...leb(count),...Array.from({length:count},()=>name('identity')).flat()];
 const single=[...name('wasmbench'),...name('identity'),0,0];
 const expected={
  'module-group':[1,...moduleGroup(8)],
  'type-group':[1,...typeGroup(8)],
  'ordinary-baseline':ordinary(8),
  'mixed-groups':[4,...single,...moduleGroup(8),...typeGroup(8),...single],
  'module-group-1024':[1,...moduleGroup(1024)],
  'type-group-1024':[1,...typeGroup(1024)],
  'ordinary-baseline-1024':ordinary(1024),
 };
 for(const f of compactImportFixtures()){
  const bytes=await readFile(new URL('../corpora/features/artifacts/compact-imports-'+f.name+'.wasm',import.meta.url));
  assert.deepEqual(importSection(bytes),expected[f.name]);
 }
});
test('compact import checksums match independent per-call arithmetic',()=>{
 for(const f of compactImportFixtures())for(const n of [1,64,4096]){
  let sum=0;for(let i=0;i<n;i++){if(f.name==='mixed-groups'){for(let offset=0;offset<6;offset++)sum=(sum+i+offset)>>>0;}else sum=(sum+i+(i+3))>>>0;}assert.equal(f.expected(n),sum);
 }
});
test('ordinary controls execute the first and last import at both table sizes',async()=>{
 for(const f of compactImportFixtures().filter(f=>f.baseline)){
  const bytes=await readFile(new URL('../corpora/features/artifacts/compact-imports-'+f.name+'.wasm',import.meta.url));
  const module=await WebAssembly.compile(bytes);assert.equal(WebAssembly.Module.imports(module).length,f.importCount);
  const instance=await WebAssembly.instantiate(module,{wasmbench:{identity:x=>x}});
  for(const n of [1,64,4096])assert.equal(instance.exports.benchmark(n)>>>0,f.expected(n));
 }
});
test('compact encodings reduce the import section without changing the control work',async()=>{
 for(const count of [8,1024]){
  const suffix=count===8?'':'-1024';
  const load=async name=>importSection(await readFile(new URL('../corpora/features/artifacts/compact-imports-'+name+suffix+'.wasm',import.meta.url)));
  const control=await load('ordinary-baseline');
  for(const name of ['module-group','type-group'])assert((await load(name)).length<control.length);
 }
});
