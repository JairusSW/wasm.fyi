import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './wasmbench.mjs';

export async function writeIndex(directory, reports) {
  const entries = [], hosts = {};
  for (const report of reports) {
    const projection = `${report.id}.summary.json`;
    const bytes = JSON.stringify(report) + '\n';
    await writeFile(join(directory, projection), bytes);
    const { id, runId, created, host, evidence, evidenceSha256 } = report;
    const hostSha256 = digest(JSON.stringify(host));
    hosts[hostSha256] = host;
    entries.push({ id, runId, created, host:{os:host.os,arch:host.arch,hostname:host.hostname}, hostSha256, evidence, evidenceSha256, projection, projectionSha256: digest(bytes) });
  }
  await writeFile(join(directory, 'index.json'), JSON.stringify({ schema: 2, hosts, reports: entries }) + '\n');
}

export function datasetFiles(index) {
  return ['index.json', ...index.reports.flatMap(r => [r.evidence, ...(r.trialsEvidence ? [r.trialsEvidence] : []), ...(r.throughputEvidence ? [r.throughputEvidence] : []), ...(index.schema === 2 ? [`${r.id}.summary.json`] : [])])];
}

// A targeted refresh must preserve the latest evidence for every host,
// configuration and corpus contract, even when that exceeds the age limit.
export function retainReports(reports,limit=12) {
  const sorted=[...reports].sort((a,b)=>b.created.localeCompare(a.created));
  const keep=new Set(sorted.slice(0,limit)),seen=new Set();
  for(const report of sorted)for(const runtime of report.runtimes)for(const workload of report.workloads){
    const key=JSON.stringify([report.host.hostname,report.host.os,report.host.arch,runtime.id,digest(JSON.stringify(runtime)),workload.id,workload.sha256]);
    if(!seen.has(key)){seen.add(key);keep.add(report);}
  }
  return sorted.filter(report=>keep.has(report));
}

// Explicit append means keep the entire prior set while replacing duplicate
// run IDs with their newly verified projection. Retention remains opt-in.
export function appendReports(previous,incoming) {
  const ids=new Set(incoming.map(report=>report.runId));
  return [...incoming,...previous.filter(report=>!ids.has(report.runId))]
    .sort((a,b)=>b.created.localeCompare(a.created));
}
