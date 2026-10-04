import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { digest } from './wasmbench.mjs';

const exportFields = [
  'schema', 'analysis_version', 'headline_latency_policy', 'summaries', 'metrics', 'scenarios',
  'artifact_structures', 'throughput', 'memory_timelines', 'paired_memory_timelines',
  'memory_stages', 'memory_source', 'code_records', 'code_source'
];

// Keep the original sealed report on its runner. Transfer only the evidence
// consumed by wasm.fyi, together with a receipt that ties it to the source seal.
export async function exportWasmFyiReport(sourceReport, destinationRoot) {
  sourceReport = resolve(sourceReport);
  destinationRoot = resolve(destinationRoot);
  const dataBytes = await readFile(join(sourceReport, 'data.json'));
  const checksumsBytes = await readFile(join(sourceReport, 'checksums.json'));
  const sourceChecksums = JSON.parse(checksumsBytes);
  const sourceReportSha256 = digest(dataBytes);
  assert.equal(sourceReportSha256, sourceChecksums['data.json'], 'Source report data does not match its seal');
  const source = JSON.parse(dataBytes);
  const manifest = source.bundle?.manifest;
  assert(manifest?.lock && Array.isArray(source.bundle?.trials), 'Report is missing its locked trial bundle');
  assert.equal(manifest.kind, 'measurement');
  assert.equal(manifest.lock.options?.profile, 'timing');
  assert(!manifest.lock.options?.correctness_only, 'Correctness-only reports are not performance snapshots');

  const data = Object.fromEntries(exportFields.filter(key => key in source).map(key => [key, source[key]]));
  data.bundle = {
    artifact_admission: source.bundle.artifact_admission || [],
    manifest,
    trials: source.bundle.trials
  };
  const encoded = Buffer.from(JSON.stringify(data) + '\n');
  const leaf = basename(dirname(sourceReport));
  assert(/^[a-zA-Z0-9-]+$/.test(leaf), 'Invalid source report identity');
  const relativeReport = `wasm-fyi/${leaf}/report`;
  const report = join(destinationRoot, relativeReport);
  await mkdir(report, { recursive: true });
  const receipt = {
    schema: 1,
    format: 'wasm-fyi-measurement-projection',
    runId: manifest.id,
    sourceReportSha256,
    sourceChecksumsSha256: digest(checksumsBytes),
    sourceReportFiles: Object.keys(sourceChecksums).length
  };
  const receiptBytes = Buffer.from(JSON.stringify(receipt) + '\n');
  await writeFile(join(report, 'data.json'), encoded);
  await writeFile(join(report, 'wasm-fyi-export.json'), receiptBytes);
  await writeFile(join(report, 'checksums.json'), JSON.stringify({
    'data.json': digest(encoded),
    'wasm-fyi-export.json': digest(receiptBytes)
  }) + '\n');
  await writeFile(join(destinationRoot, 'latest-wasm-fyi-report.txt'), relativeReport + '\n');
  return { path: relativeReport, runId: manifest.id, sourceReportSha256, bytes: encoded.length };
}

export function validateWasmFyiReceipt(receipt) {
  assert.equal(receipt?.schema, 1, 'Unsupported wasm.fyi transport schema');
  assert.equal(receipt?.format, 'wasm-fyi-measurement-projection', 'Unexpected wasm.fyi transport format');
  assert(typeof receipt.runId === 'string' && receipt.runId.length > 0, 'Missing source run identity');
  assert(/^[a-f0-9]{64}$/.test(receipt.sourceReportSha256), 'Invalid source report digest');
  assert(/^[a-f0-9]{64}$/.test(receipt.sourceChecksumsSha256), 'Invalid source seal digest');
  assert(Number.isSafeInteger(receipt.sourceReportFiles) && receipt.sourceReportFiles > 0, 'Invalid source report file count');
  if(receipt.collectionBundle){const b=receipt.collectionBundle;assert(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(b.id)&&/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(b.machine),'Invalid collection bundle identity');assert.equal(b.url,`/wasmbench/runs/${b.id}/${b.machine}/bundle/index.json`,'Invalid collection bundle URL');}
  return receipt;
}
