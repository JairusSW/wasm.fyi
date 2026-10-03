import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, site, digest } from './lib/wasmbench.mjs';
test('retained upstream sources and recipes match the selected inventory and digests',async()=>{
  const lock=JSON.parse(await readFile(join(site,'corpora/upstream/sources.json'))),settings=await config();
  assert.deepEqual(lock.benchmarks.map(b=>b.id).sort(),[...settings.corpus.ids].sort());
  assert.match(lock.revision,/^[a-f0-9]{40}$/);
  assert.equal(new Set(lock.files.map(f=>f.path)).size,lock.files.length);
  for(const f of lock.files) {
    assert(!f.path.includes('..')&&!f.path.endsWith('.wasm'));
    assert.equal(digest(await readFile(join(site,'corpora/upstream/wago',f.path))),f.sha256,f.path);
  }
  for(const b of lock.benchmarks)if(b.recipe)assert(lock.files.some(f=>f.path===b.recipe),b.id);
});
