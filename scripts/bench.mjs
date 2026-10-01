import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { digest, harness, site } from './lib/wasmbench.mjs';
import { prepareCorpus } from './lib/corpus.mjs';
import { featureConfigurations } from './lib/feature-configurations.mjs';
import { patchHarness } from './lib/harness-patch.mjs';

const action = process.argv[2];
const { root, settings, run } = await harness();
const collection = settings.collection;
const featureSuite = process.env.WASMBENCH_SUITE?.includes('corpora/features/');
const runtimes = process.env.WASMBENCH_RUNTIMES || (process.env.WASMBENCH_SUITE?.includes('corpora/features/') ? featureConfigurations(settings) : collection.runtimes).join(',');
if (runtimes.split(',').some(id => ['wasmer-llvm','wasmer-singlepass'].includes(id))) {
  const sdk=resolve(process.env.WASMBENCH_WASMER_SDK || join(homedir(),'.local/share/wasm-fyi/toolchains/wasmer-c-api-7.3.0/sdk'));
  const manifest=JSON.parse(await readFile(join(sdk,'build.json')));
  if(manifest.version!=='7.3.0' || manifest.revision!=='35c10644f7b0aad6fd9458624ceb8429fe7413c4' || digest(await readFile(join(sdk,'lib',manifest.library)))!==manifest.librarySha256)throw new Error('Selected Wasmer SDK differs from its pinned build manifest');
  process.env.WASMBENCH_WASMER_SDK=sdk;
}
const number = (name, fallback, minimum = 1) => {
  const input = process.env[name];
  const value = Number(input?.trim() ? input : fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}`);
  return value;
};
const invoke = (...args) => process.stdout.write(run(...args));
const pass = (...args) => {
  try { invoke(...args); } catch (error) {
    if (process.env.WASMBENCH_RECORD_FAILURES !== '1' || args[0] !== 'run') throw error;
    const output = args[args.indexOf('--out') + 1];
    // Only an intact sealed bundle can turn trial failures into data. Missing
    // evidence and transport/infrastructure errors still stop the update.
    invoke('verify', '--run', output);
    console.log('Recorded failed trial outcomes; no failed-cell timings may be published.');
  }
};
if (action === 'corpus') await prepareCorpus(settings, run);
else if (action === 'corpus-check') {
  const suite = await prepareCorpus(settings, run);
  const id = 'corpus-check-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  invoke('check', '--suite', suite, '--runtimes', runtimes, '--scenarios', 'first-call,steady', '--launches', '1', '--samples', '1', '--operations', '1', '--warmup', '0', '--timeout', collection.timeout, '--out', join(site, '.wasmbench/experiments', id));
}
else if (action === 'doctor') invoke('doctor');
else if (action === 'build') {
  patchHarness(root);
  const args = ['build', '--runtimes', runtimes];
  if (runtimes.split(',').includes('wago')) args.push('--wago-source', resolve(site, process.env.WAGO_SOURCE || collection.wagoSource));
  invoke(...args);
} else if (action === 'collect') {
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const directory = join(site, '.wasmbench/experiments', id);
  await mkdir(directory, { recursive: true });
  const timing = join(directory, `timing-${id}`);
  const suite = await prepareCorpus(settings, run, directory);
  const shared = ['--suite', suite, '--runtimes', runtimes, '--timeout', collection.timeout, ...(process.env.WASMBENCH_VALIDATION_PROFILE ? ['--validation-profile', process.env.WASMBENCH_VALIDATION_PROFILE] : [])];
  pass('run', ...shared, '--profile', 'timing', '--launches', String(number('WASMBENCH_LAUNCHES', featureSuite ? 3 : collection.launches)),
    '--samples', String(number('WASMBENCH_SAMPLES', featureSuite ? 3 : collection.samples)), '--operations', String(number('WASMBENCH_OPERATIONS', collection.operations)),
    '--warmup', String(number('WASMBENCH_WARMUP', collection.warmup, 0)), '--out', timing);
  invoke('verify', '--run', timing);
  const report = join(directory, 'report');
  const reportArgs = ['report', '--run', timing, '--out', report];
  if (collection.memory) {
    const memory = join(directory, `memory-${id}`);
    const args = ['run', ...shared, '--profile', 'memory', '--launches', String(number('WASMBENCH_LAUNCHES', featureSuite ? 3 : collection.launches)),
      '--samples', '1', '--operations', '1', '--warmup', '0', '--out', memory];
    if (collection.phaseBarriers) args.push('--phase-barriers');
    pass(...args);
    invoke('verify', '--run', memory);
    reportArgs.push('--memory-run', memory);
  }
  if (collection.code) {
    const code = join(directory, `code-${id}`);
    pass('run', ...shared, '--profile', 'code', '--scenarios', 'compile', '--launches', '1', '--samples', '1', '--operations', '1', '--warmup', '0', '--out', code);
    invoke('verify', '--run', code);
    reportArgs.push('--code-run', code);
  }
  invoke(...reportArgs);
  invoke('verify-report', '--dir', report);
  await writeFile(join(site, '.wasmbench/latest-report.txt'), report + '\n');
  console.log(`Sealed experiment retained at ${directory}`);
} else throw new Error('Usage: node scripts/bench.mjs doctor|build|corpus|corpus-check|collect');
