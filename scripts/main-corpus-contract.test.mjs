import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertMainCorpusContract } from './lib/main-corpus-contract.mjs';
import { site, config } from './lib/wasmbench.mjs';

const empty = Buffer.from('0061736d01000000', 'hex');
const uleb = n => { const out=[]; do { const b=n&127;n>>>=7;out.push(b|(n?128:0)); } while(n); return out; };
const text = s => [...uleb(Buffer.byteLength(s)), ...Buffer.from(s)];
function imported(module, name) {
  const section=[1,...text(module),...text(name),0,0];
  return Buffer.from([...empty,1,4,1,0x60,0,0,2,...uleb(section.length),...section]);
}
const workload = { id: 'wago/test', abi: 'core' };
test('main corpus checks artifact imports rather than trusting ABI labels', () => {
  assert.deepEqual(assertMainCorpusContract(workload, empty), []);
  for (const module of ['wasi_snapshot_preview1','wasi_unstable','wasi:cli/run@0.2.0','env']) {
    assert.throws(() => assertMainCorpusContract(workload, imported(module, 'fd_write')), /host import forbidden/);
  }
  assert.throws(() => assertMainCorpusContract({ ...workload, abi: 'wasi-command' }, empty), /core ABI/);
  assert.throws(() => assertMainCorpusContract({ ...workload, command: {} }, empty), /command\/host glue/);
});
test('only the declared fail-closed AssemblyScript assertion callback is allowed', () => {
  const abort=imported('env','abort');
  assert.throws(() => assertMainCorpusContract(workload, abort), /host import forbidden/);
  assert.equal(assertMainCorpusContract({ ...workload, host_profile: 'assemblyscript-abort-v1' }, abort).length, 1);
  assert.throws(() => assertMainCorpusContract({ ...workload, host_profile: 'assemblyscript-abort-v1' }, imported('env','read')), /host import forbidden/);
});
test('configured application corpus enforces core admission; feature WASI remains separate', async () => {
  assert.equal((await config()).corpus.requireCore, true);
  const applications=JSON.parse(await readFile(join(site,'corpora/applications/manifest.json')));
  for (const w of applications) assertMainCorpusContract(w, await readFile(join(site,'corpora/applications',w.artifact)));
  const features=JSON.parse(await readFile(join(site,'corpora/features/manifest.json')));
  assert(features.some(w=>w.abi==='wasi-command'));
  assert(features.some(w=>w.abi==='component'));
});
test('all 21 retired commands have distinct active core identities and exact source contracts', async () => {
  const read=async path=>JSON.parse(await readFile(join(site,path)));
  const settings=await config();
  const mapping=await read('corpora/nonwasi/replacements.json');
  const retained=await read('corpora/upstream/contracts.json');
  const sources=await read('corpora/upstream/sources.json');
  const selection=await read('corpora/selection.json');
  assert.equal(mapping.workloads.length,21);
  assert.equal(new Set(mapping.workloads.map(w=>w.previous)).size,21);
  assert.equal(new Set(mapping.workloads.map(w=>w.replacement)).size,21);
  assert.equal(retained.length,64);
  assert(retained.every(w=>w.abi==='core'&&!w.command));
  for(const {previous,replacement,group} of mapping.workloads) {
    assert.notEqual(previous,replacement);
    assert(!retained.some(w=>w.id===previous));
    assert(!selection.workloads.some(w=>w.id===previous));
    assert(!settings.corpus.ids.includes(previous.split('/')[1]));
    const contract=retained.find(w=>w.id===replacement);
    assert(contract,replacement);
    assert.equal(contract.oracle.kind,'exact_u64');
    assert(contract.oracle.expected.length>0);
    assert.equal(contract.reset,'stateless');
    assert(selection.workloads.some(w=>w.id===replacement));
    const record=sources.benchmarks.find(w=>w.id===replacement.split('/')[1]);
    assert.equal(record.replaces,previous);
    assert.equal(record.group,group);
    assert.match(await readFile(join(site,'scripts','nonwasi-'+group+'.mjs'),'utf8'),/WebAssembly\.Module\.imports/);
  }
});
