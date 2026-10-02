import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applicationWorkloads } from './application-manifest.mjs';
import { site } from './wasmbench.mjs';

export async function prepareCorpus(settings, run, directory) {
  const selected = process.env.WASMBENCH_SUITE || settings.collection.suite;
  if (selected !== 'wago') return selected.endsWith('.json') ? resolve(site, selected) : selected;
  const corpus = settings.corpus;
  if (corpus?.source !== 'wago' || !Array.isArray(corpus.ids) || !corpus.ids.length) throw new Error('Configure the Wago corpus selection');
  const ids = process.env.WASMBENCH_CORPUS_IDS ? process.env.WASMBENCH_CORPUS_IDS.split(',') : corpus.ids;
  if (ids.some(id => !corpus.ids.includes(id)) || new Set(ids).size !== ids.length) throw new Error('Corpus override must select unique configured Wago IDs');
  const source = resolve(site, process.env.WASMBENCH_CORPUS_SOURCE || process.env.WAGO_SOURCE || settings.collection.wagoSource);
  const output = directory || join(site, '.wasmbench/corpora', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  await mkdir(output, { recursive: true });
  const manifest = join(output, 'wago-suite.json');
  process.stdout.write(run('import-wago', '--source', source, '--ids', ids.join(','), '--out', manifest));
  const workloads = JSON.parse(await readFile(manifest, 'utf8'));
  if (!Array.isArray(workloads) || !workloads.length || new Set(workloads.map(w => w.id)).size !== workloads.length) throw new Error('Invalid imported corpus');
  // Explicit Wago subsets remain bounded; opt applications in with their own IDs.
  const applicationIds = process.env.WASMBENCH_APPLICATION_IDS?.split(',').filter(Boolean);
  const applications = process.env.WASMBENCH_CORPUS_IDS && applicationIds === undefined ? [] : await applicationWorkloads(corpus.applications, applicationIds);
  workloads.push(...applications);
  if(new Set(workloads.map(w=>w.id)).size!==workloads.length)throw Error('Duplicate combined corpus IDs');
  await writeFile(manifest, JSON.stringify(workloads, null, 2) + '\n');
  const summary = { source: 'wago + wasm.fyi application kernels', selectedBenchmarks: ids, applicationContracts: applications.length, workloadContracts: workloads.length,
    executable: workloads.filter(w => !w.unsupported_reason).length,
    unsupported: workloads.filter(w => w.unsupported_reason).map(w => ({ id: w.id, reason: w.unsupported_reason })),
    workloads: workloads.map(w => ({ id: w.id, sha256: w.sha256, abi: w.abi, license: w.license, source: w.source, provenance: w.provenance })) };
  await writeFile(join(output, 'corpus-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`Corpus: ${ids.length} upstream benchmarks + ${applications.length} application kernel contracts, ${workloads.length} contracts; ${summary.unsupported.length} explicitly unsupported contracts.`);
  return manifest;
}
