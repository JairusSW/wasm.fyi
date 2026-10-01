import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './wasmbench.mjs';

export async function writeIndex(directory, reports) {
  const entries = [];
  for (const report of reports) {
    const projection = `${report.id}.summary.json`;
    const bytes = JSON.stringify(report) + '\n';
    await writeFile(join(directory, projection), bytes);
    const { id, runId, created, host, evidence, evidenceSha256 } = report;
    entries.push({ id, runId, created, host, evidence, evidenceSha256, projection, projectionSha256: digest(bytes) });
  }
  await writeFile(join(directory, 'index.json'), JSON.stringify({ schema: 2, reports: entries }) + '\n');
}

export function datasetFiles(index) {
  return ['index.json', ...index.reports.flatMap(r => [r.evidence, ...(index.schema === 2 ? [`${r.id}.summary.json`] : [])])];
}
