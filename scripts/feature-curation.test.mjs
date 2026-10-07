import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fixtures, featureIds } from '../corpora/features/generator.mjs';
import { fixtures as coreFixtures } from '../corpora/features/curated-core.mjs';
import { checkV8 } from './lib/v8-corpus.mjs';
import { digest, site } from './lib/wasmbench.mjs';

const root = join(site, 'corpora/features');
const generated = fixtures();
const executableScope = new Set(['execution', 'memory-bandwidth', 'host-interface', 'host-interface-result-code']);
const compileOnlyFeatures = new Set(['core-val', 'extended-const', 'cm-async']);
const manifest = async () => JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const id = (fixture, size) => `features/${fixture.feature}/${fixture.name}/${size}`;
const localPath = (base, relative) => {
  assert.equal(typeof relative, 'string');
  const path = resolve(base, relative);
  assert.ok(path.startsWith(resolve(base) + sep), `Path must stay inside corpus: ${relative}`);
  return path;
};

test('execution diversity counts operations once, excluding baselines and size-only variants', () => {
  for (const feature of featureIds.filter(feature => !compileOnlyFeatures.has(feature))) {
    const operations = new Set(generated.filter(f => f.feature === feature && !f.baseline && executableScope.has(f.scope))
      .map(f => {
        // Conservative equivalence classes prevent type/alignment/call-form
        // variants from satisfying the algorithm-diversity floor.
        if(f.feature==='reference-types' && ['table-null-check','externref-null'].includes(f.name))return 'table-null-check';
        if(f.feature==='core-mem' && ['load-store-sequential','load-store-unaligned'].includes(f.name))return 'load-store';
        if(f.feature==='multi-value' && ['pair-results','block-parameters'].includes(f.name))return 'tuple-arithmetic';
        if(f.feature==='tail-call' && ['direct-recursion','indirect-recursion'].includes(f.name))return 'recursive-sum';
        return f.name.replace(/-\d+$/, '');
      }));
    assert.ok(operations.size >= 5, `${feature} has ${operations.size} distinct executable operation names`);
  }
  // The old direct/indirect tail recursion and pair/block arithmetic overlap.
  // Require four genuinely additional named algorithms in these families.
  for (const feature of ['multi-value', 'tail-call']) {
    assert.ok(coreFixtures().filter(f => f.feature === feature).length >= 4, feature);
  }
});

test('shared curated modules have identical source and unique named benchmark exports', () => {
  const modules = new Map();
  for (const f of generated.filter(f => f.module)) {
    assert.equal(f.scope, 'execution', f.name);
    assert.ok(f.sizes.every(n => Number.isInteger(n) && n > 0 && n <= 4096), f.name);
    assert.equal(f.reset, 'stateless', f.name);
    assert.equal(typeof f.expected, 'function', f.name);
    assert.ok(f.export && f.export !== 'benchmark', f.name);
    assert.ok(f.wat.includes(`(export "${f.export}")`), f.name);
    if (f.initialize) assert.ok(f.wat.includes(`(export "${f.initialize}")`), f.name);
    const previous = modules.get(f.module);
    if (previous) {
      assert.equal(f.wat, previous.wat, `Conflicting source for ${f.module}`);
      assert.ok(!previous.exports.has(f.export), `Duplicate export ${f.module}/${f.export}`);
      previous.exports.add(f.export);
    } else modules.set(f.module, { wat: f.wat, exports: new Set([f.export]) });
  }
  assert.ok(modules.size >= 16);
});

test('compile and initializer scaling remain explicitly separate from execution workloads', () => {
  for (const f of generated.filter(f => compileOnlyFeatures.has(f.feature))) {
    assert.ok(['compile-only', 'compile-and-instantiate'].includes(f.scope), f.name);
    if (f.scope === 'compile-only') {
      assert.equal(f.export, '', f.name);
      assert.equal(f.oracle(f.sizes[0]).kind, 'component_compile_only', f.name);
    }
  }
});

test('every manifest contract matches its source, artifact, export, initializer and independent oracle', async () => {
  const rows = await manifest();
  const expectedRows = new Map(generated.flatMap(f => f.sizes.map(size => [id(f, size), { f, size }])));
  assert.equal(rows.length, expectedRows.size, 'Manifest inventory must match fixture contracts');
  assert.equal(new Set(rows.map(w => w.id)).size, rows.length, 'Duplicate manifest IDs');
  const bytes = new Map();
  const cachedRead = path => {
    if (!bytes.has(path)) bytes.set(path, readFile(path));
    return bytes.get(path);
  };
  for (const w of rows) {
    const entry = expectedRows.get(w.id);
    assert.ok(entry, `Unexpected manifest contract: ${w.id}`);
    const { f, size } = entry;
    const source = (await cachedRead(localPath(root, w.source))).toString('utf8');
    const artifact = await cachedRead(localPath(root, w.artifact));
    assert.equal(source, f.wat.trim() + '\n', `Stale source: ${w.id}`);
    assert.equal(digest(source), w.provenance.recipe.sourceSha256, `Source digest: ${w.id}`);
    assert.equal(digest(artifact), w.sha256, `Artifact digest: ${w.id}`);
    assert.equal(w.provenance.recipe.sha256, w.sha256, `Recipe artifact digest: ${w.id}`);
    assert.equal(w.provenance.recipe.source, w.source, w.id);
    assert.equal(w.provenance.recipe.artifact, w.artifact, w.id);
    assert.equal(w.export, f.export ?? 'benchmark', `Export: ${w.id}`);
    assert.equal(w.initialize, f.initialize, `Initializer: ${w.id}`);
    assert.equal(w.abi, f.abi || 'core', w.id);
    assert.equal(w.reset, f.reset, w.id);
    assert.equal(w.host_profile, f.hostProfile, w.id);
    assert.deepEqual(w.args, f.args ? f.args(size) : [f.abi === 'component' ? String(size) : size], w.id);
    assert.deepEqual(w.oracle, f.oracle ? f.oracle(size) : {
      kind: 'exact_u64', expected: [f.abi === 'component' ? String(f.expected(size)) : f.expected(size)]
    }, `Independent oracle: ${w.id}`);
    assert.equal(w.provenance.scope, f.scope, w.id);
    assert.equal(w.provenance.recipe.scope, f.scope, w.id);
    assert.equal(w.provenance.baseline, Boolean(f.baseline), w.id);
    if (f.module) {
      assert.equal(w.provenance.recipe.module, f.module, w.id);
      assert.equal(w.provenance.recipe.export, f.export, w.id);
    }
    if (f.command) assert.deepEqual(w.command, f.command(size), w.id);
  }
});

test('curated ordinary core workloads declare only the intended string builtins as imports', () => {
  for (const f of generated.filter(f => f.module && (f.abi || 'core') === 'core')) {
    for (const [, namespace, name] of f.wat.matchAll(/\(import\s+"([^"]+)"\s+"([^"]+)"/g)) {
      assert.equal(f.feature, 'js-string-builtins', `${f.feature}: unexpected import ${namespace}.${name}`);
      assert.equal(f.hostProfile, 'js-string-builtins-v1', f.name);
      assert.equal(namespace, 'wasm:js-string', f.name);
      assert.ok(['fromCharCode', 'charCodeAt', 'fromCodePoint', 'codePointAt', 'length'].includes(name), name);
    }
  }
});

test('upstream selections retain source pins, local digests, licenses and positive-only assertion accounting', async () => {
  const upstream = join(root, 'upstream');
  const index = JSON.parse(await readFile(join(upstream, 'index.json'), 'utf8'));
  assert.equal(index.schema, 1);
  assert.match(index.purpose, /not.*(?:performance|execution)/i);
  assert.match(index.selectionPolicy, /allowlist/i);
  const licenses = {
    'https://github.com/WebAssembly/spec': ['Apache-2.0', 'spec-test-LICENSE'],
    'https://github.com/v8/v8': ['BSD-3-Clause', 'v8-LICENSE'],
    'https://github.com/bytecodealliance/wasmtime': ['Apache-2.0 WITH LLVM-exception', 'wasmtime-LICENSE']
  };
  assert.equal(new Set(index.sources.map(source => source.id)).size, index.sources.length);
  let assertions = 0, vectors = 0;
  for (const source of index.sources) {
    assert.ok(licenses[source.repository], `Repository needs explicit review: ${source.repository}`);
    const [license, filename] = licenses[source.repository];
    assert.equal(source.license, license, source.id);
    const licenseText = await readFile(join(upstream, 'licenses', filename), 'utf8');
    assert.ok(licenseText.length >= 1000, `Missing full license: ${source.id}`);
    assert.match(source.revision, /^[0-9a-f]{40}$/, source.id);
    assert.match(source.upstreamSha256, /^[0-9a-f]{64}$/, source.id);
    assert.match(source.localSha256, /^[0-9a-f]{64}$/, source.id);
    assert.equal(source.upstreamUrl, `${source.repository}/blob/${source.revision}/${source.upstreamPath}`, source.id);
    const contents = await readFile(localPath(upstream, source.localPath));
    assert.equal(digest(contents), source.localSha256, source.id);
    if (source.kind === 'selected-positive-wast') {
      const text = contents.toString('utf8');
      assert.doesNotMatch(text, /\(assert_(?:trap|invalid|malformed|unlinkable|exhaustion)\b/, source.id);
      const positiveCount = [...text.matchAll(/\(assert_return\b/g)].length;
      assert.equal(positiveCount, source.assertions, source.id);
      assert.ok(positiveCount > 0, source.id);
      assert.equal([...text.matchAll(/^\(invoke\b/gm)].length, source.setupInvocations, source.id);
      for (const [, namespace, name] of text.matchAll(/\(import\s+"([^"]+)"\s+"([^"]+)"/g)) {
        assert.equal(namespace, 'spectest', source.id);
        assert.equal(name, 'print_i32_f32', source.id);
      }
      assertions += positiveCount;
    } else {
      assert.equal(source.kind, 'portable-semantic-vectors', source.id);
      const data = JSON.parse(contents);
      assert.equal(data.source, source.id);
      assert.equal(data.license, source.license);
      assert.equal(data.cases.length, source.cases);
      assert.ok(data.cases.length > 0, source.id);
      vectors += data.cases.length;
    }
  }
  assert.ok(assertions >= 100, 'Expected a material positive semantic selection');
  assert.ok(vectors >= 100, 'Expected both Unicode/vector supplements');
});

test('core curated algorithms match independent oracles at varied runtime inputs and reused instances', async () => {
  const rows = await manifest();
  const instances = new Map();
  const samples = [0, 1, 2, 3, 7, 15, 31, 64, 65, 97, 128, 257, 4096];
  for (const f of coreFixtures()) {
    const row = rows.find(w => w.id === id(f, 64));
    assert.ok(row, `Missing core curated contract: ${f.name}`);
    if (!instances.has(f.module)) {
      const bytes = await readFile(localPath(root, row.artifact));
      const module = await WebAssembly.compile(bytes);
      assert.deepEqual(WebAssembly.Module.imports(module), [], f.module);
      instances.set(f.module, new WebAssembly.Instance(module));
    }
    const instance = instances.get(f.module);
    for (const n of samples) for (let repeat = 0; repeat < 2; repeat++) {
      assert.equal(instance.exports[f.export](n) >>> 0, f.expected(n), `${f.feature}/${f.name}(${n}), repeat ${repeat}`);
    }
  }
});

test('ordinary curated verification rejects changed artifact digests and wrong arithmetic oracles', async () => {
  const row = (await manifest()).find(w => w.id === 'features/core-tab/indirect-sorting-network/64');
  assert.ok(row);
  const workload = { ...row, artifact: localPath(root, row.artifact) };
  assert.equal((await checkV8(workload, { repeat: 1 })).status, 'verified');
  await assert.rejects(checkV8({ ...workload, sha256: '0'.repeat(64) }, { repeat: 1 }), /digest mismatch/);
  await assert.rejects(checkV8({ ...workload, oracle: { kind: 'exact_u64', expected: [row.oracle.expected[0] + 1] } }, { repeat: 1 }), /Incorrect result/);
});
