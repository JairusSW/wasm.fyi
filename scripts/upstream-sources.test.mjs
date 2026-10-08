import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, site, digest } from './lib/wasmbench.mjs';
import { selectRetainedSources } from './lib/upstream-source-selection.mjs';
test('source refresh preserves new core ports and fails closed on unresolved selections',()=>{
  const replacement={id:'lua-memory-buckets',replaces:'wago/lua-cli-buckets',group:'runtimes'};
  const result=selectRetainedSources(['tiny','lua-memory-buckets'],[{id:'tiny'},{id:'lua-cli-buckets'}],[replacement]);
  assert.deepEqual(result.selected,[{id:'tiny'}]);
  assert.deepEqual(result.replacements,[replacement]);
  assert.throws(()=>selectRetainedSources(['tiny','missing'],[{id:'tiny'}],[replacement]),/refusing to replace/);
});
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

test('in-memory yyjson and NanoSVG recipes preserve import-free core library linking',async()=>{
  const contracts=JSON.parse(await readFile(join(site,'corpora/upstream/contracts.json')));
  for(const id of ['yyjson','nanosvg']) {
    const recipe=await readFile(join(site,'corpora/upstream/wago/corpus/workloads/semantic',id,'build.sh'),'utf8');
    // An explicit ctor export suppresses wasm-ld's command-export wrapper,
    // whose libc stdio destructor would otherwise retain clock_time_get.
    assert.match(recipe,/-Wl,--export=__wasm_call_ctors/);
    assert.match(recipe,new RegExp('-Wl,--export='+id+'_run'));
    const contract=contracts.find(w=>w.id.split('/')[1]===id);
    assert.equal(contract.abi,'core');
    assert.equal(contract.initialize,undefined);
    assert.equal(contract.oracle.kind,'exact_u64');
  }
});
