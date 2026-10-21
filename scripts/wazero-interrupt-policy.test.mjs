import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertWazeroInterruptsDisabled,disableWazeroInterrupts,restoreHistoricalWazeroSources} from './lib/wazero-sampling.mjs';

test('Wazero benchmark adapters cannot silently re-enable context interruption',()=>{
 assert.doesNotThrow(()=>assertWazeroInterruptsDisabled('"context_termination":"disabled"'));
 assert.throws(()=>assertWazeroInterruptsDisabled('c.WithCloseOnContextDone(true)'),/must stay disabled/);
 assert.throws(()=>assertWazeroInterruptsDisabled('"context_termination":"enabled"'),/still claims/);
});
test('legacy harnesses are normalized before rebuilding',()=>{
 const source=disableWazeroInterrupts('c.WithCloseOnContextDone(true); "context_termination":"enabled"');
 assert(!source.includes('WithCloseOnContextDone'));assert(source.includes('"context_termination":"disabled"'));
});
test('historical Wazero restoration retains collector files absent from the frozen harness',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wazero-history-'));
 try{
  const root=join(directory,'current'),base=join(directory,'frozen');
  await mkdir(join(root,'adapters/wazero'),{recursive:true});await mkdir(join(base,'adapters/wazero'),{recursive:true});
  await writeFile(join(root,'adapters/wazero/main.go'),'current 1.12.0');
  await writeFile(join(root,'adapters/wazero/sampling_test.go'),'collector-only');
  await writeFile(join(base,'adapters/wazero/main.go'),'frozen 1.12.0');
  assert.deepEqual(await restoreHistoricalWazeroSources(root,base,'1.12.1'),['main.go']);
  assert.equal(await readFile(join(root,'adapters/wazero/main.go'),'utf8'),'frozen 1.12.1');
  assert.equal(await readFile(join(root,'adapters/wazero/sampling_test.go'),'utf8'),'collector-only');
 }finally{await rm(directory,{recursive:true,force:true})}
});
