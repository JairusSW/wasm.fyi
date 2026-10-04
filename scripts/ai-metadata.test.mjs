import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAiMetadata, siteUrl, sha256 } from './lib/ai-metadata.mjs';

function fixture() {
  const view = {
    schema: 1, encoding: 'indexed-cells-v1', configurations: { A: 'engine-baseline', B: 'engine-other' },
    catalogue: [{ id: 'features/a/test & <one>', artifactSha256: 'a'.repeat(64), kb: 2, ms: 99, group: 'Tests', purpose: 'A | workload\nwith text', baseline: false, workUnit: 'invocation', unitsPerInvocation: 1, abi: 'core', reset: 'fresh_instance', oracle: { kind: 'exact' } }],
    metrics: ['compile', 'rss', 'code'], statuses: ['ok', 'unsupported', 'failed', 'nm', 'na'], reportIds: ['new', 'old'],
    reports: {
      new: { created: '2026-10-01T12:00:00Z', runId: 'new-run', evidence: 'new.json', sha256: 'b'.repeat(64), configurations: ['engine-baseline'], host: 'linux', options: {} },
      old: { created: '2026-09-01T12:00:00Z', runId: 'old-run', evidence: 'history/old.json', sha256: 'c'.repeat(64), configurations: ['engine-baseline'], host: 'linux', options: {} }
    },
    reasons: ['collector unavailable'], hosts: { m1: { label: 'Test host', os: 'linux/x64', policy: {}, configurations: { A: { runtime: 'engine-baseline', backend: 'baseline', version: 'exact-revision' } }, snapshots: {
      s1: [[0, 0, 0, 0, 0, 0, [0, 0], [0], null], [0, 0, 1, 3, 0, null, null, [], 0], [0, 0, 2, 2, 0, null, null, [], 0]],
      s2: [[0, 0, 2, 0, 1, 123, null, [123], null]]
    } } }, history: { m1: {} }, threads: { m1: { created: '2026-09-01', sha256: 'd'.repeat(64), evidence: 'worker.json' } }
  };
  const features = { schema: 1, policy: 'Representative corpus, not conformance.', expectedFeatures: ['a'], hosts: [{ host: { hostname: 'test', os: 'linux', arch: 'x64' }, configurations: [{ id: 'engine-baseline', identity: 'pinned', description: {}, features: [{ id: 'a', coverage: 'not-tested', cases: [], executed: 0, compiledOnly: 0, unsupported: 0, failed: 0 }] }] }] };
  return { view, features };
}
function render(options = {}) {
  const { view, features } = fixture();
  return renderAiMetadata(view, features, { sourceSha256: 's'.repeat(64), featuresSha256: 'f'.repeat(64), ...options });
}
const read = (artifacts, name) => JSON.parse(artifacts.get('data/llm/' + name));

test('exports numeric zero, null, reasons, intervals and newest failure without backfilling', () => {
  const artifacts = render(), rows = ['compile', 'rss', 'code'].flatMap(metric => read(artifacts, `benchmarks-m1-s1-${metric}.json`).results);
  assert.equal(rows[0].value, 0); assert.deepEqual(rows[0].interval, [0, 0]); assert.deepEqual(rows[0].launchMedians, [0]);
  assert.equal(rows[1].value, null); assert.equal(rows[1].status, 'not-measured'); assert.equal(rows[1].reason, 'collector unavailable');
  assert.equal(rows[2].status, 'failed'); assert.equal(rows[2].value, null); assert.equal(rows[2].report, 'new');
  assert.equal(read(artifacts, 'benchmarks-m1-s2-code.json').results[0].value, 123);
  assert.equal(read(artifacts, 'benchmarks-m1-s1-compile.json').missingCellStatus, 'not-measured');
  assert(!rows.some(r => r.configuration === 'B'), 'Absent is not invented unsupported evidence');
});

test('uses explicit units, safe workload URLs and direct sealed report links', () => {
  const artifacts = render({ base: '/wasm.fyi' });
  const manifest = read(artifacts, 'index.json');
  assert.equal(manifest.url, 'https://wasm.fyi/wasm.fyi/');
  const rows = ['compile', 'rss', 'code'].flatMap(metric => read(artifacts, `benchmarks-m1-s1-${metric}.json`).results);
  assert.deepEqual(rows.map(r => r.unit), ['ms', 'MiB', 'KiB']);
  assert.equal(rows[0].runtime, 'engine-baseline');
  const workload = read(artifacts, 'workloads.json').workloads[0];
  assert.equal(workload.artifactBytes, 2048); assert(!('ms' in workload)); assert(!('kb' in workload));
  assert.equal(workload.url, 'https://wasm.fyi/wasm.fyi/bench/features/a/test%20%26%20%3Cone%3E/');
  assert.equal(read(artifacts, 'reports.json').reports.old.summaryUrl, 'https://wasm.fyi/wasm.fyi/wasmbench/history/old.summary.json');
  assert(artifacts.get('robots.txt').includes('Sitemap: https://wasm.fyi/wasm.fyi/sitemap.xml'));
  assert(artifacts.get('sitemap.xml').includes(workload.url));
  assert.equal(manifest.provenance.measuredViewSha256, 's'.repeat(64));
  assert.equal(manifest.datasets[0].sha256, sha256(artifacts.get('data/llm/benchmarks-m1-s1-compile.json')));
});

test('expanded text is deterministic, preserves unknown coverage and makes no winner claims', () => {
  assert.deepEqual(render(), render());
  const text = render().get('llms-full.txt');
  assert(text.includes('| m1 | B (engine-other) | 0 | 0 | 0 | 0 | 3 |'));
  assert(text.includes('| a | not-tested | 0 | 0 | 0 | 0 |'));
  assert(text.includes('A   workload with text'));
  assert(text.includes('No global fastest-runtime ranking'));
  assert(text.includes('Target week and actual collection date differ'));
  assert(!text.includes('undefined'));
});

test('fails closed on corrupt references, unknown encoding and non-ok values', () => {
  for (const mutate of [
    v => { v.encoding = 'new'; }, v => { v.metrics[0] = 'mystery'; },
    v => { v.hosts.m1.snapshots.s1[0][4] = 99; }, v => { v.hosts.m1.snapshots.s1[0][5] = NaN; },
    v => { v.hosts.m1.snapshots.s1[0][5] = null; }, v => { v.hosts.m1.snapshots.s1[1][5] = 1; },
    v => { v.hosts.m1.snapshots.s1[1][8] = 99; }, v => { v.hosts.m1.snapshots.s1.push(v.hosts.m1.snapshots.s1[0]); }
  ]) {
    const { view, features } = fixture(); mutate(view); assert.throws(() => renderAiMetadata(view, features));
  }
});

test('input changes regenerate outputs and project-path builds never reuse root links', () => {
  const { view, features } = fixture();
  const before = renderAiMetadata(view, features);
  view.hosts.m1.snapshots.s1[0][5] = 0.25;
  view.reports.new.created = '2026-10-02T12:00:00Z';
  features.hosts[0].configurations[0].features[0].coverage = 'tested';
  const after = renderAiMetadata(view, features, { base: '/wasm.fyi' });
  assert.notEqual(before.get('data/llm/benchmarks-m1-s1-compile.json'), after.get('data/llm/benchmarks-m1-s1-compile.json'));
  assert(after.get('llms-full.txt').includes('2026-10-02T12:00:00Z'));
  assert(after.get('llms-full.txt').includes('| a | tested |'));
  assert(!after.get('llms.txt').includes('(https://wasm.fyi/data/'));
  assert.throws(() => siteUrl('llms.txt', '//elsewhere'));
  assert.throws(() => siteUrl('llms.txt', '/a/../b'));
});

test('output verification rejects missing, stale and wrong-base-path files', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { checkAiMetadata } = await import('./ai-metadata.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'wasm-ai-test-'));
  try {
    const artifacts = render();
    for (const [path, text] of artifacts) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), text);
    }
    await checkAiMetadata(directory, artifacts);
    await assert.rejects(checkAiMetadata(directory, render({ base: '/wasm.fyi' })), /stale machine-readable/);
    await writeFile(join(directory, 'data/llm/obsolete.json'), '{}');
    await assert.rejects(checkAiMetadata(directory, artifacts), /artifact inventory/);
    await rm(join(directory, 'data/llm/obsolete.json'));
    await writeFile(join(directory, 'llms.txt'), 'stale');
    await assert.rejects(checkAiMetadata(directory, artifacts), /stale machine-readable/);
    await rm(join(directory, 'data/llm/index.json'));
    await assert.rejects(checkAiMetadata(directory, artifacts), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('exports interpreter native code as not applicable without duplicate cells',()=>{
  const {view,features}=fixture();
  view.hosts.m1.snapshots.s1[2][3]=4;
  const artifacts=renderAiMetadata(view,features);
  const row=read(artifacts,'benchmarks-m1-s1-code.json').results[0];
  assert.equal(row.status,'not-applicable');assert.equal(row.value,null);
});
