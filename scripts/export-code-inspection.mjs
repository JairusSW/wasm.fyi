// Publish compact, hash-checked byte views from sealed code-profile bundles.
// Usage: node scripts/export-code-inspection.mjs <code-run> [...code-runs]
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { digest, harness, site } from './lib/wasmbench.mjs';

const bundles = process.argv.slice(2).map(path => resolve(path));
if (!bundles.length) throw new Error('Pass one or more sealed code-profile bundle paths.');
const { root, run } = await harness();
for (const bundle of bundles) {
  run('verify', '--run', bundle);
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json')));
  if (manifest.lock?.options?.profile !== 'code') throw new Error(`Not a code-profile bundle: ${bundle}`);
  const runId = manifest.id;
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error(`Unsafe run ID: ${runId}`);
  const checksums = JSON.parse(await readFile(join(bundle, 'checksums.json')));
  const workloads = new Map(manifest.lock.workloads.map(workload => [workload.id, workload.sha256]));
  const target = join(site, 'static/wasmbench/code-inspection', runId);
  await mkdir(target, { recursive: true });
  const records = [];
  for (const entry of await (await import('node:fs/promises')).readdir(join(bundle, 'trials'))) {
    if (!entry.endsWith('.json')) continue;
    const trialPath = join(bundle, 'trials', entry);
    const trialBytes = await readFile(trialPath);
    const relative = `trials/${entry}`;
    if (digest(trialBytes) !== checksums[relative]) throw new Error(`Trial checksum mismatch: ${relative}`);
    const trial = JSON.parse(trialBytes);
    const image = trial.code_image;
    if (trial.profile !== 'code' || trial.block < 0 || trial.status !== 'ok' || !image?.data) continue;
    const bytes = Buffer.from(image.data, 'base64');
    if (digest(bytes) !== image.sha256 || image.module_sha256 !== workloads.get(trial.workload)) throw new Error(`Native image identity mismatch: ${trial.id}`);
    const filename = `${trial.id}.bin`;
    await writeFile(join(target, filename), bytes);
    const { data, ...metadata } = image;
    const record = { trial: trial.id, runtime: trial.runtime_configuration, workload: trial.workload, image: metadata, imageBytes: bytes.length, imageFile: filename };
    await writeFile(join(target, `${trial.id}.json`), JSON.stringify(record) + '\n');
    records.push(record);
  }
  const sourceChecksumsSha256 = digest(await readFile(join(bundle, 'checksums.json')));
  await writeFile(join(target, 'index.json'), JSON.stringify({ schema: 1, runId, sourceChecksumsSha256, records: records.map(({ image, ...record }) => ({ ...record, image: { version: image.version, sha256: image.sha256, architecture: image.architecture, backend: image.backend, section_kind: image.section_kind, functions: image.functions || [] } })) }) + '\n');
  await copyFile(join(site, 'static/wasmbench/code-inspection/view.html'), join(target, 'view.html'));
  console.log(`${runId}: published ${records.length} verified machine-code images (${sourceChecksumsSha256}); source bundle ${basename(bundle)}`);
}
