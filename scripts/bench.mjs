import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { harness, site } from './lib/wasmbench.mjs';
import { prepareCorpus } from './lib/corpus.mjs';
import { patchHarness } from './lib/harness-patch.mjs';

const action = process.argv[2];
const { root, settings, run } = await harness();
const collection = settings.collection;
const runtimes = process.env.WASMBENCH_RUNTIMES || collection.runtimes.join(',');
const number = (name, fallback, minimum = 1) => {
  const input = process.env[name];
  const value = Number(input?.trim() ? input : fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}`);
  return value;
};
const invoke = (...args) => process.stdout.write(run(...args));
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
  const shared = ['--suite', suite, '--runtimes', runtimes, '--timeout', collection.timeout];
  invoke('run', ...shared, '--profile', 'timing', '--launches', String(number('WASMBENCH_LAUNCHES', collection.launches)),
    '--samples', String(number('WASMBENCH_SAMPLES', collection.samples)), '--operations', String(number('WASMBENCH_OPERATIONS', collection.operations)),
    '--warmup', String(number('WASMBENCH_WARMUP', collection.warmup, 0)), '--out', timing);
  invoke('verify', '--run', timing);
  const report = join(directory, 'report');
  const reportArgs = ['report', '--run', timing, '--out', report];
  if (collection.memory) {
    const memory = join(directory, `memory-${id}`);
    const args = ['run', ...shared, '--profile', 'memory', '--launches', String(number('WASMBENCH_LAUNCHES', collection.launches)),
      '--samples', '1', '--operations', '1', '--warmup', '0', '--out', memory];
    if (collection.phaseBarriers) args.push('--phase-barriers');
    invoke(...args);
    invoke('verify', '--run', memory);
    reportArgs.push('--memory-run', memory);
  }
  if (collection.code) {
    const code = join(directory, `code-${id}`);
    invoke('run', ...shared, '--profile', 'code', '--scenarios', 'compile', '--launches', '1', '--samples', '1', '--operations', '1', '--warmup', '0', '--out', code);
    invoke('verify', '--run', code);
    reportArgs.push('--code-run', code);
  }
  invoke(...reportArgs);
  invoke('verify-report', '--dir', report);
  await writeFile(join(site, '.wasmbench/latest-report.txt'), report + '\n');
  console.log(`Sealed experiment retained at ${directory}`);
} else throw new Error('Usage: node scripts/bench.mjs doctor|build|corpus|corpus-check|collect');
