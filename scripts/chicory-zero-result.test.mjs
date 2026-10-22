import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

for(const adapter of ['features/ChicoryAdapter.java','qualification/ChicoryJitAdapter.java']){
 test(`${adapter} accepts Chicory's null representation for zero-result exports`,async()=>{
  const source=await readFile(new URL(`../adapters/${adapter}`,import.meta.url),'utf8');
  const invoke='long[] result=i.export(name).apply(args);';
  const normalize='if(result==null&&type.returns().isEmpty())result=new long[0];';
  const arity='require(result.length==type.returns().size(),"result arity mismatch");';
  assert.equal(source.split(invoke).length,2,'expected exactly one runtime invocation');
  assert(source.indexOf(invoke)<source.indexOf(normalize));
  assert(source.indexOf(normalize)<source.indexOf(arity));
 });
}

test('weekly Chicory controller refresh carries the AOT implementation used by current runner sources',async()=>{
 const source=await readFile(new URL('./weekly-build.mjs',import.meta.url),'utf8');
 assert(source.includes("'experiment/aot.go','experiment/extra_runtimes.go'"));
});
