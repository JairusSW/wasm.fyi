import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compact, digest, json } from './wasmbench.mjs';

const sha = /^[a-f0-9]{64}$/;
const nonnegative = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const interval = (low, high) => (low == null && high == null) || (nonnegative(low) && nonnegative(high) && low != null && high != null && low <= high);
export function validateReport(report) {
  assert(sha.test(report.id), 'Invalid source report SHA-256');
  assert(sha.test(report.lockSha256), 'Invalid lock SHA-256');
  assert(typeof report.runId === 'string' && report.runId.length, 'Missing run identity');
  assert.equal(report.options.profile, 'timing', 'Only timing measurement reports are accepted');
  assert(!report.options.correctness_only, 'Correctness checks are not performance evidence');
  assert.equal(report.publication, 'local_exploratory', 'Publication trust is not established by this collector');
  assert(report.runtimes.length && report.workloads.length, 'Empty report cohort');
  const configurations = new Set(report.runtimes.map(r => r.id));
  const workloads = new Set(report.workloads.map(w => w.id));
  assert.equal(configurations.size, report.runtimes.length, 'Duplicate configuration identity');
  assert.equal(workloads.size, report.workloads.length, 'Duplicate workload identity');
  for (const w of report.workloads) assert(sha.test(w.sha256), `Missing artifact hash: ${w.id}`);
  assert(report.host?.os && report.host?.arch && report.created, 'Missing host or timestamp');
  const cells = new Set();
  for (const s of report.summaries) {
    assert(configurations.has(s.runtime) && workloads.has(s.workload), 'Summary is outside the locked cohort');
    const key = JSON.stringify([s.runtime, s.workload, s.scenario, s.profile]);
    assert(!cells.has(key), 'Duplicate summary cell'); cells.add(key);
    assert(nonnegative(s.median_ns_per_operation), 'Invalid latency median');
    assert(interval(s.ci95_low, s.ci95_high), 'Invalid latency interval');
    if (s.median_ns_per_operation !== null) {
      assert.equal(s.latency_status, 'timing_pass', 'Diagnostic latency leaked into headline data');
      assert.equal(s.profile, 'timing', 'Non-timing summary leaked into headline data');
    }
    if (s.independent_launches < 3) assert(s.ci95_low == null && s.ci95_high == null, 'Unsupported confidence interval');
    for (const count of Object.values(s.outcomes)) assert(Number.isInteger(count) && count >= 0, 'Invalid outcome count');
  }
  for (const m of report.memory) {
    assert(configurations.has(m.runtime) && workloads.has(m.workload), 'Memory is outside the locked cohort');
    assert(nonnegative(m.median_bytes) && interval(m.ci95_low_bytes, m.ci95_high_bytes), 'Invalid memory measurement');
    assert(report.memorySource, 'Memory values require matched-pass provenance');
  }
  for (const c of report.codeRecords || []) {
    assert(configurations.has(c.runtime) && workloads.has(c.workload), 'Code record is outside the locked cohort');
    assert(nonnegative(c.image_bytes), 'Invalid code-image size');
    if (c.image_bytes !== null) assert.equal(c.status, 'available', 'Unavailable code must not have a value');
  }
}
export async function validateData(directory) {
  const index = await json(resolve(directory, 'index.json'));
  assert.equal(index.schema, 1, 'Unsupported frontend projection schema');
  assert(index.reports?.length, 'No reports in snapshot index');
  const identities = new Set();
  for (const report of index.reports) {
    validateReport(report);
    assert(!identities.has(report.runId), 'Duplicate run in snapshot index'); identities.add(report.runId);
    assert(/^[a-f0-9]{64}\.json$/.test(report.evidence), 'Unsafe evidence path');
    assert(sha.test(report.evidenceSha256), 'Missing collected evidence digest');
    const bytes = await readFile(resolve(directory, report.evidence));
    assert.equal(digest(bytes), report.evidenceSha256, `Evidence digest mismatch: ${report.evidence}`);
    const evidence = JSON.parse(bytes);
    validateReport(evidence);
    const { evidenceSha256, ...indexed } = report;
    assert.deepEqual(indexed, compact(evidence), 'Index disagrees with its evidence');
    assert(Array.isArray(evidence.trials), 'Missing raw trial evidence');
  }
  return index;
}
