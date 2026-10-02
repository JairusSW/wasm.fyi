import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { digest, harness, site } from './lib/wasmbench.mjs';
import { prepareCorpus } from './lib/corpus.mjs';
import { featureConfigurations } from './lib/feature-configurations.mjs';
import { patchHarness } from './lib/harness-patch.mjs';
import { prepareFeatureTools } from './lib/feature-tools.mjs';
import { releaseSource, assertReleasedSource } from './lib/release-policy.mjs';
import { verifyV8 } from './lib/v8-preflight.mjs';
import {wasmerRelease,assertWasmerReceipt} from './lib/wasmer-release.mjs';

const action = process.argv[2];
const { root, settings, run } = await harness();
const collection = {...settings.collection, timeout:process.env.WASMBENCH_TIMEOUT || settings.collection.timeout};
const featureSuite = process.env.WASMBENCH_SUITE?.includes('corpora/features/') || process.env.WASMBENCH_SUITE==='all';
const runtimes = process.env.WASMBENCH_RUNTIMES || (featureSuite ? featureConfigurations(settings) : collection.runtimes).join(',');
if(['build','collect','corpus-check'].includes(action) && runtimes.split(',').includes('wago')) {
  process.env.WASMBENCH_CORPUS_SOURCE ||= process.env.WAGO_SOURCE || collection.wagoSource;
  const release=await releaseSource('wago-org/wago',{asOf:process.env.WASMBENCH_RELEASE_AS_OF});
  assertReleasedSource(release.source,release);
  process.env.WAGO_SOURCE=release.source;
}
if(runtimes.split(',').includes('wavm') && ['build','collect','corpus-check'].includes(action))throw Error('The available WAVM SDK is an unreleased build and cannot be collected.');
if(featureSuite && ['build','collect'].includes(action))await prepareFeatureTools(root,settings,runtimes.split(','));
if (runtimes.split(',').some(id => ['wasmer-llvm','wasmer-singlepass'].includes(id))) {
  const pin=wasmerRelease(process.env.WASMBENCH_WASMER_VERSION);
  const sdk=resolve(process.env.WASMBENCH_WASMER_SDK || join(homedir(),`.local/share/wasm-fyi/toolchains/wasmer-c-api-${pin.version}/sdk`));
  const manifest=JSON.parse(await readFile(join(sdk,'build.json')));
  assertWasmerReceipt(manifest,pin,digest(await readFile(join(sdk,'lib',manifest.library))));
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
  // Always rebuild the Wago adapter after selecting a release. A previously
  // compiled binary cannot inherit the new source identity.
  if(runtimes.split(',').includes('wago')) {patchHarness(root);invoke('build','--runtimes','wago','--wago-source',process.env.WAGO_SOURCE);}
  verifyV8(root, settings.node, runtimes.split(','));
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const directory = join(site, '.wasmbench/experiments', id);
  await mkdir(directory, { recursive: true });
  const timing = join(directory, `timing-${id}`);
  const suite = await prepareCorpus(settings, run, directory);
  const shared = ['--archive-tools=true','--suite', suite, '--runtimes', runtimes, '--timeout', collection.timeout, ...(process.env.WASMBENCH_VALIDATION_PROFILE ? ['--validation-profile', process.env.WASMBENCH_VALIDATION_PROFILE] : [])];
  pass('run', ...shared, '--profile', 'timing', '--launches', String(number('WASMBENCH_LAUNCHES', collection.launches)),
    '--samples', String(number('WASMBENCH_SAMPLES', collection.samples)), '--operations', String(number('WASMBENCH_OPERATIONS', collection.operations)),
    '--warmup', String(number('WASMBENCH_WARMUP', collection.warmup, 0)), '--out', timing);
  invoke('verify', '--run', timing);
  const report = join(directory, 'report');
  const reportArgs = ['report', '--run', timing, '--out', report];
  if (collection.memory) {
    const memory = join(directory, `memory-${id}`);
    const args = ['run', ...shared, '--profile', 'memory', '--launches', '1',
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
