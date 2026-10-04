import { parseArgs } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { compact, digest, exists, harness, installDirectory, site } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';
import { verifySeal } from './lib/verify-seal.mjs';
import { withholdFailedCells } from './lib/measurement-policy.mjs';
import { writeIndex } from './lib/snapshot-index.mjs';
import { validateWasmFyiReceipt } from './lib/wasmfyi-export.mjs';

const { values, positionals } = parseArgs({ options: { output: { type: 'string' }, rebuild: { type: 'boolean', default: false } }, allowPositionals: true });
const { root, settings, run } = await harness();
const destination = resolve(values.output || join(site, 'data/wasmbench'));
const sources = positionals.length ? positionals.map(path => ({ path: resolve(path), rebuild: values.rebuild })) : settings.reports;
if (!sources?.length) throw new Error('No sealed report sources configured');
const temp = await mkdtemp(join(tmpdir(), 'wasm-fyi-report-'));
await mkdir(resolve(destination, '..'), { recursive: true });
const staging = await mkdtemp(join(resolve(destination, '..'), '.gather-'));
try {
  const reports = [];
  for (const [index, source] of sources.entries()) {
    let dir = resolve(root, source.path);
    const rebuild = source.rebuild || values.rebuild;
    const originalBytes = await exists(join(dir, 'data.json')) ? await readFile(join(dir, 'data.json')) : null;
    const wasmfyiPath = join(dir, 'wasm-fyi-export.json');
    const wasmfyi = await exists(wasmfyiPath) ? validateWasmFyiReceipt(JSON.parse(await readFile(wasmfyiPath, 'utf8'))) : null;
    const sealed = await exists(join(dir, 'checksums.json'));
    if (sealed) await verifySeal(dir);
    else if (!rebuild) throw new Error(`Unsealed report requires explicit rebuilding from sealed raw bundles: ${dir}`);
    if (wasmfyi && rebuild) throw new Error('A wasm.fyi transport projection cannot be rebuilt without its retained source report.');
    const originalData = originalBytes ? JSON.parse(originalBytes) : {};
    if (originalData.publication) throw new Error('Qualified publication requires separate operator-key verification.');
    if (rebuild) {
      for (const path of ['raw', 'raw-memory', 'code/raw', 'raw-code']) {
        if (await exists(join(dir, path))) run('verify', '--run', join(dir, path));
      }
      const original = dir;
      dir = join(temp, `report-${index}`);
      const command = ['report', '--run', join(original, 'raw'), '--out', dir];
      if (await exists(join(original, 'raw-memory'))) command.push('--memory-run', join(original, 'raw-memory'));
      if (await exists(join(original, 'code/raw'))) command.push('--code-run', join(original, 'code/raw'));
      else if (await exists(join(original, 'raw-code'))) command.push('--code-run', join(original, 'raw-code'));
      run(...command);
    }
    if (!wasmfyi) run('verify-report', '--dir', dir);
    const bytes = await readFile(join(dir, 'data.json'));
    const checksums = JSON.parse(await readFile(join(dir, 'checksums.json'), 'utf8'));
    if (digest(bytes) !== checksums['data.json']) throw new Error(`Report changed after verification: ${dir}`);
    const data = JSON.parse(bytes);
    const manifest = data.bundle?.manifest;
    if (data.schema !== 1 || !manifest?.lock || !Array.isArray(data.summaries)) throw new Error(`Unsupported report schema: ${dir}`);
    if (manifest.kind !== 'measurement' || manifest.lock.options.correctness_only || manifest.lock.options.profile !== 'timing') {
      throw new Error(`Expected a performance timing report: ${dir}`);
    }
    if (data.publication) throw new Error('Qualified publication requires separate operator-key verification.');
    const id = digest(bytes);
    reports.push({
      id, sourceReportSha256: wasmfyi?.sourceReportSha256 || (originalBytes ? digest(originalBytes) : null), sourceReportSealed: wasmfyi ? true : sealed, runId: manifest.id, created: manifest.created, publication: manifest.publication,
      analysisVersion: data.analysis_version, source: source.path.split('/').at(-1),
      host: manifest.host, options: manifest.lock.options, lockSha256: manifest.lock_sha256,
      runtimes: manifest.lock.runtime_configurations, workloads: manifest.lock.workloads,
      summaries: withholdFailedCells(data.summaries), memory: data.memory_stages || [], memorySource: data.memory_source || null,
      metrics: data.metrics, scenarios: data.scenarios,
      latencyPolicy: data.headline_latency_policy, artifactStructures: data.artifact_structures || [],
      artifactAdmission: data.bundle.artifact_admission || [], codeRecords: data.code_records || [],
      codeSource: data.code_source || null, memoryTimelines: data.paired_memory_timelines || data.memory_timelines || [],
      evidence: `${id}.json`, trialsEvidence: `${id}.trials.json`, throughputEvidence: `${id}.throughput.json`
    });
    const trialStrings = new Map();
    const intern = value => {
      if (value == null) return null;
      const key = typeof value === 'string' ? value : JSON.stringify(value);
      if (!trialStrings.has(key)) trialStrings.set(key, trialStrings.size);
      return trialStrings.get(key);
    };
    const projected = reports.at(-1);
    const trials = data.bundle.trials.map(t => [t.id, intern(t.runtime_configuration), intern(t.workload),
      intern(t.scenario), intern(t.profile), t.block, intern(t.status), intern(t.reason), t.started, t.duration_ns,
      t.samples?.map(s => [s.index, s.warmup, s.elapsed_ns, s.operations, intern(s.sample_type), s.verified, s.result ?? null]) ?? null,
      intern(t.log), intern(t.isolation)]);
    projected.__trialPayload = {schema:'interned-columns-v1',trialColumns:['id','runtime_configuration','workload','scenario','profile','block','status','reason','started','duration_ns','samples','log','isolation'],sampleColumns:['index','warmup','elapsed_ns','operations','sample_type','verified','result'],strings:[...trialStrings.keys()],trials};
    projected.__throughputPayload = data.throughput || [];
    console.log(`Verified ${manifest.id}: ${manifest.lock.runtime_configurations.length} configurations, ${manifest.lock.workloads.length} workloads`);
    // The projection is now in memory. Bound disk usage to one rebuilt report;
    // original sealed inputs remain available for inspection and retries.
    if (rebuild) await rm(dir, { recursive: true, force: true });
  }
  const index = [];
  for (const report of reports) {
    // Raw evidence is machine-readable; compact encoding keeps broad corpora
    // within GitHub file and Pages artifact limits without dropping samples.
    const trials = JSON.stringify(report.__trialPayload) + '\n';
    const throughput = JSON.stringify(report.__throughputPayload) + '\n';
    report.trialsSha256 = digest(trials); report.throughputSha256 = digest(throughput);
    delete report.__trialPayload; delete report.__throughputPayload;
    const bytes = JSON.stringify(report) + '\n';
    if (Buffer.byteLength(bytes) > 95 * 1024 * 1024) throw new Error('Evidence exceeds the GitHub single-file publication budget; reduce collection samples or split the configured corpus before publishing.');
    await writeFile(join(staging, report.evidence), bytes);
    await writeFile(join(staging, report.trialsEvidence), trials);
    await writeFile(join(staging, report.throughputEvidence), throughput);
    index.push({ ...compact(report), evidenceSha256: digest(bytes) });
  }
  await writeIndex(staging, index);
  // The inventory belongs to the research pass, not to the deployed snapshot list.
  if (await exists(join(destination, 'report-catalog.json'))) await cp(join(destination, 'report-catalog.json'), join(staging, 'report-catalog.json'));
  await validateData(staging);
  const finish = await installDirectory(staging, destination);
  await finish(false);
  console.log(`Gathered ${reports.length} verified snapshots into ${destination}`);
} finally {
  await rm(temp, { recursive: true, force: true });
  await rm(staging, { recursive: true, force: true });
}
