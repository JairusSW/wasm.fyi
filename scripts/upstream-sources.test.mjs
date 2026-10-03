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

test('every selected upstream contract has an active source build and standalone fixtures',async()=>{
  const lock=JSON.parse(await readFile(join(site,'corpora/upstream/sources.json')));
  const contracts=JSON.parse(await readFile(join(site,'corpora/upstream/contracts.json')));
  assert.equal(contracts.length,lock.benchmarks.length);
  assert.deepEqual(contracts.map(w=>w.id.split('/')[1]).sort(),lock.benchmarks.map(b=>b.id).sort());
  for(const b of lock.benchmarks) {
    assert.equal(b.workflow,'source-build',b.id);
    assert.equal(b.sourceBuild,'scripts/corpus-rebuild.mjs',b.id);
  }
  for(const w of contracts) {
    assert(!w.artifact.startsWith('/')&&!w.artifact.includes('..'));
    for(const file of Object.values(w.command?.files || {})) {
      assert(file.path.startsWith('corpora/upstream/wago/corpus/'));
      assert.equal(digest(await readFile(join(site,file.path))),file.sha256,w.id);
    }
  }
});
