import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compact, digest, installDirectory } from './lib/wasmbench.mjs';
import { validateReport, validateData } from './lib/validate-data.mjs';

function report() {
  return { id: 'a'.repeat(64), lockSha256: 'b'.repeat(64), runId: 'fixture', created: '2026-10-01T00:00:00Z',
    publication: 'local_exploratory', options: { profile: 'timing' }, host: { os: 'linux', arch: 'arm64' },
    runtimes: [{ id: 'engine/backend' }], workloads: [{ id: 'core/add', sha256: 'c'.repeat(64) }],
    summaries: [{ runtime: 'engine/backend', workload: 'core/add', scenario: 'compile', profile: 'timing',
      median_ns_per_operation: 0, ci95_low: null, ci95_high: null, independent_launches: 1,
      latency_status: 'timing_pass', outcomes: { ok: 1, unsupported: 1 } }],
    memory: [], memorySource: null, codeRecords: [], evidence: 'a'.repeat(64) + '.json', trials: [] };
}

test('retains true zero, missing intervals and partial failure outcomes', () => validateReport(report()));
test('rejects diagnostic timing masquerading as latency', () => {
  const value = report(); value.summaries[0].latency_status = 'not_timing_pass';
  assert.throws(() => validateReport(value), /Diagnostic latency/);
});
test('rejects invented one-launch confidence intervals', () => {
  const value = report(); value.summaries[0].ci95_low = 0; value.summaries[0].ci95_high = 1;
  assert.throws(() => validateReport(value), /Unsupported confidence interval/);
});
test('rejects values outside the exact locked configuration/workload cohort', () => {
  const value = report(); value.summaries[0].runtime = 'other-backend';
  assert.throws(() => validateReport(value), /outside the locked cohort/);
});
test('rejects memory values without paired-pass provenance', () => {
  const value = report(); value.memory = [{ runtime: 'engine/backend', workload: 'core/add', median_bytes: 100 }];
  assert.throws(() => validateReport(value), /matched-pass provenance/);
});
test('checks evidence digests and rejects unsafe paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wasm-fyi-validation-'));
  try {
    const value = report(); const bytes = JSON.stringify(value);
    const indexed = { ...compact(value), evidenceSha256: digest(bytes) };
    await writeFile(join(directory, value.evidence), bytes);
    await writeFile(join(directory, 'index.json'), JSON.stringify({ schema: 1, reports: [indexed] }));
    await validateData(directory);
    await writeFile(join(directory, value.evidence), bytes + ' ');
    await assert.rejects(validateData(directory), /Evidence digest mismatch/);
    indexed.evidence = '../outside.json';
    await writeFile(join(directory, 'index.json'), JSON.stringify({ schema: 1, reports: [indexed] }));
    await assert.rejects(validateData(directory), /Unsafe evidence path/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('directory installation failure restores the previous dataset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wasm-fyi-rollback-'));
  try {
    const destination = join(directory, 'current');
    await mkdir(destination); await writeFile(join(destination, 'index.json'), 'previous');
    await assert.rejects(installDirectory(join(directory, 'missing'), destination));
    assert.equal(await readFile(join(destination, 'index.json'), 'utf8'), 'previous');
    const staged = join(directory, 'staged'); await mkdir(staged); await writeFile(join(staged, 'index.json'), 'next');
    const undo = await installDirectory(staged, destination);
    assert.equal(await readFile(join(destination, 'index.json'), 'utf8'), 'next');
    await undo(true);
    assert.equal(await readFile(join(destination, 'index.json'), 'utf8'), 'previous');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
