import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { availableParallelism, cpus, homedir } from 'node:os';
import { command, digest, harness, site } from './lib/wasmbench.mjs';
import { prepareCorpus } from './lib/corpus.mjs';
import { featureConfigurations } from './lib/feature-configurations.mjs';
import { patchHarness } from './lib/harness-patch.mjs';
import { prepareFeatureTools } from './lib/feature-tools.mjs';
import { releaseSource, assertReleasedSource } from './lib/release-policy.mjs';
import { verifyV8 } from './lib/v8-preflight.mjs';
import {wasmerRelease,assertWasmerReceipt} from './lib/wasmer-release.mjs';
import {workersWithinCpuBudget} from './lib/worker-budget.mjs';

const action = process.argv[2];
// Collection is allowed to publish a complete, checksummed bundle with failed
// cells so unsupported contracts remain visible as failures instead of
// discarding otherwise valid measurements. The pass() helper still verifies
// every sealed run before continuing.
if (action === 'collect') process.env.WASMBENCH_RECORD_FAILURES ||= '1';
const { root, settings, run } = await harness();
const collection = {...settings.collection, timeout:process.env.WASMBENCH_TIMEOUT || settings.collection.timeout};
if(collection.v8CompilerMode)process.env.WASMBENCH_V8_COMPILER_MODE ||= collection.v8CompilerMode;
const featureSuite = process.env.WASMBENCH_SUITE?.includes('corpora/features/') || process.env.WASMBENCH_SUITE==='all';
const runtimes = process.env.WASMBENCH_RUNTIMES || (featureSuite ? featureConfigurations(settings) : collection.runtimes).join(',');
if(runtimes.split(',').includes('wasmer-llvm') && ['build','collect','corpus-check'].includes(action))throw Error('wasmer-llvm is retired from the website benchmark collection; use wasmer-singlepass.');
const extraToolsNeeded = runtimes.split(',').some(id => ['wasm3','wamr','spidermonkey','deno','jsc'].includes(id));
if(runtimes.split(',').includes('wavm')) {
  process.env.WASMBENCH_WAVM_VERSION ||= 'nightly-2026-04-05-4e82bb9';
  process.env.WASMBENCH_WAVM_SDK ||= join(homedir(),'.local/share/wasm-fyi/toolchains/wavm-nightly-2026-04-05/sdk');
}
if(['build','collect','corpus-check'].includes(action) && runtimes.split(',').includes('wago')) {
  process.env.WASMBENCH_CORPUS_SOURCE ||= process.env.WAGO_SOURCE || collection.wagoSource;
  const release=await releaseSource('wago-org/wago',{asOf:process.env.WASMBENCH_RELEASE_AS_OF,betaPrerelease:true});
  assertReleasedSource(release.source,release);
  process.env.WAGO_SOURCE=release.source;
}
if(runtimes.split(',').includes('wavm') && ['build','collect','corpus-check'].includes(action) && !/^nightly-\d{4}-\d{2}-\d{2}-[a-f0-9]{7,40}$/.test(process.env.WASMBENCH_WAVM_VERSION || ''))throw Error('Set WASMBENCH_WAVM_VERSION to the exact prerelease tag and source commit used to build the WAVM SDK.');
if((featureSuite || extraToolsNeeded) && ['build','collect','corpus-check'].includes(action)) {
  const releaseJsc=process.env.WASMBENCH_JSC,releaseJscVersion=process.env.WASMBENCH_JSC_VERSION;
  await prepareFeatureTools(root,settings,runtimes.split(','));
  // Keep a release-bound JSC shell selected instead of silently replacing it
  // with the pinned development shell prepared for ordinary current checks.
  if(releaseJsc)process.env.WASMBENCH_JSC=releaseJsc;
  if(releaseJscVersion)process.env.WASMBENCH_JSC_VERSION=releaseJscVersion;
}
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
const verifyCorpusV8 = suite => {
  const selected=process.env.WASMBENCH_SUITE || collection.suite;
  if(['wago','all','corpora/features/manifest.json'].includes(selected))
    process.stdout.write(command(process.execPath,[join(site,'scripts/corpus-v8.mjs'),'--suite-only',suite]));
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
  verifyCorpusV8(suite);
  const id = 'corpus-check-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  invoke('check', '--suite', suite, '--runtimes', runtimes, '--scenarios', 'first-call,steady', '--launches', '1', '--samples', '1', '--operations', '1', '--warmup', '0', '--timeout', collection.timeout, '--validation-profile',process.env.WASMBENCH_VALIDATION_PROFILE || collection.validationProfile || 'all', '--out', join(site, '.wasmbench/experiments', id));
}
else if (action === 'doctor') invoke('doctor');
else if (action === 'build') {
  if (process.env.WASMBENCH_SKIP_HARNESS_PATCH !== '1') patchHarness(root);
  const args = ['build', '--runtimes', runtimes];
  if (runtimes.split(',').includes('wago')) args.push('--wago-source', resolve(site, process.env.WAGO_SOURCE || collection.wagoSource));
  invoke(...args);
} else if (action === 'collect') {
  // Resolve the selected release through the harness build cache. Only changed
  // source, adapter or toolchain inputs require another compilation.
  if(runtimes.split(',').includes('wago')) {
    if(process.env.WASMBENCH_SKIP_WAGO_BUILD==='1')console.log('Using the prebuilt Wago adapter for this isolated worker.');
    else {if (process.env.WASMBENCH_SKIP_HARNESS_PATCH !== '1') patchHarness(root);invoke('build','--runtimes','wago','--wago-source',process.env.WAGO_SOURCE);}
  }
  verifyV8(root, settings.node, runtimes.split(','),process.env.WASMBENCH_V8_COMPILER_MODE);
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const directory = join(site, '.wasmbench/experiments', id);
  await mkdir(directory, { recursive: true });
  const timing = join(directory, `timing-${id}`);
  const suite = await prepareCorpus(settings, run, directory);
  verifyCorpusV8(suite);
  // Keep phase order stable across harness versions: compile, instantiate,
  // first use, warmed execution. Lifetime RSS is reaped from those same trials;
  // a single steady memory pass retains heap/boundary metrics before native code.
  const lifecycleScenarios=['compile','instantiate','first-call','steady'];
  const shared = ['--archive-tools=true','--suite', suite, '--runtimes', runtimes, '--timeout', collection.timeout, '--validation-profile',process.env.WASMBENCH_VALIDATION_PROFILE || collection.validationProfile || 'all'];
  const logicalCpus=cpus().length;
  const availableCpus=availableParallelism();
  const requestedWorkers=number('WASMBENCH_WORKERS',collection.workers||1);
  const workers=workersWithinCpuBudget(logicalCpus,requestedWorkers,availableCpus);
  if(workers!==requestedWorkers)console.log(`Capped benchmark workers from ${requestedWorkers} to ${workers} (${logicalCpus} available logical CPUs; at most one quarter in parallel).`);
  shared.push('--workers',String(workers));
  const lifecycleArgs = [...shared, '--scenarios', lifecycleScenarios.join(',')];
  const scenarioSamples = process.env.WASMBENCH_SCENARIO_SAMPLES
    ? JSON.parse(process.env.WASMBENCH_SCENARIO_SAMPLES)
    : collection.scenarioSamples || {'*': 1};
  const timingPeakRSS=collection.memory && collection.timingPeakRSS !== false && process.env.WASMBENCH_TIMING_ONLY !== '1';
  pass('run', ...lifecycleArgs, ...(timingPeakRSS ? ['--timing-peak-rss'] : []), '--profile', 'timing', '--launches', String(number('WASMBENCH_LAUNCHES', collection.launches)),
    '--samples', String(number('WASMBENCH_SAMPLES', collection.samples)), '--operations', String(number('WASMBENCH_OPERATIONS', collection.operations)),
    '--samples-by-scenario', JSON.stringify(scenarioSamples),
    '--warmup', String(number('WASMBENCH_WARMUP', collection.warmup, 0)), '--out', timing);
  invoke('verify', '--run', timing);
  const report = join(directory, 'report');
  const reportArgs = ['report', '--run', timing, '--out', report];
  if (collection.memory && process.env.WASMBENCH_TIMING_ONLY !== '1') {
    const memory = join(directory, `memory-${id}`);
    const memoryScenarios=timingPeakRSS ? ['steady'] : lifecycleScenarios;
    const args = ['run', ...shared, '--scenarios',memoryScenarios.join(','), '--profile', 'memory', '--launches', '1',
      '--samples', '1', '--operations', '1', '--warmup', '0', '--out', memory];
    if (collection.phaseBarriers) args.push('--phase-barriers');
    pass(...args);
    invoke('verify', '--run', memory);
    reportArgs.push('--memory-run', memory);
  }
  if (collection.code && process.env.WASMBENCH_TIMING_ONLY !== '1') {
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
