import assert from 'node:assert/strict';
import test from 'node:test';
import inventory from '../corpora/catalog.json' with { type: 'json' };
import { getPreparedWorkload, listPreparedWorkloads, PREPARED_CATALOG_POLICY, PREPARED_CATALOG_SOURCE } from '../src/lib/server/prepared-workloads.ts';

const workloads = listPreparedWorkloads();

test('prepared workload pages use exact, safe, unique API contract IDs', () => {
  const expected = inventory.workloads.filter(workload => workload.status === 'prepared');
  assert.equal(workloads.length, expected.length);
  assert.ok(workloads.length > 0);
  assert.equal(new Set(workloads.map(workload => workload.id)).size, workloads.length);
  assert.deepEqual(workloads.map(workload => workload.id), expected.map(workload => workload.contractId).sort());
  for (const workload of workloads) {
    assert.match(workload.id, /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/);
    assert.ok(!workload.id.split('/').some(segment => segment === '.' || segment === '..'));
    assert.equal(workload.path, `/bench/${workload.id}/`);
    assert.equal(getPreparedWorkload(workload.id), workload);
  }
});

test('prepared metadata is sourced from committed contracts without measurement claims', () => {
  for (const workload of workloads) {
    const source = inventory.workloads.find(item => item.contractId === workload.id);
    for (const key of ['description', 'category', 'algorithm', 'abi', 'workUnit', 'unitsPerInvocation', 'reset', 'artifactBytes', 'license', 'status']) {
      assert.deepEqual(workload[key], source[key], `${workload.id}: ${key}`);
    }
    assert.equal(workload.artifactSha256, source.sha256);
    assert.match(workload.artifactSha256, /^[a-f0-9]{64}$/);
    assert.ok(workload.source.repository || workload.source.path);
    if (workload.source.repository) assert.match(workload.source.repository, /^https:\/\//);
    for (const key of ['measurements', 'latencyNs', 'capturedAt', 'updatedAt', 'ranking', 'runtimeSupport']) assert.ok(!(key in workload));
  }
  assert.match(PREPARED_CATALOG_POLICY, /not measured results or current runtime support/);
  assert.match(PREPARED_CATALOG_SOURCE, /\/corpora\/catalog\.json$/);
});

test('live imports and malformed IDs are not fabricated as prepared contracts', () => {
  for (const id of ['not-in-prepared-inventory', '../applications/audio-adpcm', '/applications/audio-adpcm', 'applications/audio-adpcm/', 'applications%2Faudio-adpcm', '__proto__']) assert.equal(getPreparedWorkload(id), null);
  const copy = listPreparedWorkloads();
  copy.pop();
  assert.equal(listPreparedWorkloads().length, workloads.length);
  assert.deepEqual(listPreparedWorkloads(), workloads);
});
