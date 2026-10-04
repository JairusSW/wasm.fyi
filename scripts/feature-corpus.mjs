import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtures, featureIds } from '../corpora/features/generator.mjs';
import { sourceAdapter } from './feature-adapter-source.mjs';
import { featureCompiler } from './lib/feature-toolchain.mjs';
import { prepareFeatureTools } from './lib/feature-tools.mjs';
import { featureConfigurations } from './lib/feature-configurations.mjs';
import { command, digest, harness, site } from './lib/wasmbench.mjs';

const action = process.argv[2] || 'build';
const root = join(site, 'corpora/features');
const manifest = join(root, 'manifest.json');
const requested=process.argv.find(a=>a.startsWith('--ids='))?.slice(6).split(',');
const chosen=fixtures().filter(f=>!requested||requested.includes(`features/${f.feature}/${f.name}`));
if(requested?.some(id=>!chosen.some(f=>id===`features/${f.feature}/${f.name}`)))throw Error('Unknown feature corpus');
if (action === 'build') {
  const compilerBinary = await featureCompiler();
  const compiler = command(compilerBinary, ['--version']).toString().trim();
  if (!compiler.startsWith('wasm-tools 1.260.0')) throw new Error('Rebuild requires wasm-tools 1.260.0');
  const adapter = chosen.some(f=>f.wasiAdapter)?await sourceAdapter():{path:null,sha256:null};
  const adapterPath = adapter.path, adapterSha = adapter.sha256;
  const previous=requested?JSON.parse(await readFile(manifest)):[];
  const oldBuild=requested?JSON.parse(await readFile(join(root,'build.json'))):{recipes:[]};
  const workloads = previous.filter(w=>!requested?.includes(w.id.split('/').slice(0,3).join('/'))), recipes = oldBuild.recipes.filter(r=>!requested?.includes(`features/${r.feature}/${r.variant}`)), failures = [];
  await mkdir(join(root, 'sources'), { recursive: true });
  await mkdir(join(root, 'artifacts'), { recursive: true });
  for (const fixture of chosen) {
    const stem = `${fixture.feature}-${fixture.name}`;
    const source = `sources/${stem}.wat`, artifact = `artifacts/${stem}.wasm`;
    await writeFile(join(root, source), fixture.wat.trim() + '\n');
    try {
      if (fixture.wasiAdapter) {
        const core = join(root, 'artifacts', stem + '.core.wasm');
        command(compilerBinary, ['parse', join(root, source), '-o', core]);
        command(compilerBinary, ['component', 'new', core, '--adapt', 'wasi_snapshot_preview1=' + adapterPath, '-o', join(root, artifact)]);
      } else command(compilerBinary, ['parse', join(root, source), '-o', join(root, artifact)]);
      command(compilerBinary, ['validate', '--features', 'all', join(root, artifact)]);
    } catch {
      failures.push(stem); continue;
    }
    const sha256 = digest(await readFile(join(root, artifact)));
    const recipe = { source, sourceSha256: digest(await readFile(join(root, source))), artifact, sha256, compiler,
      argv: fixture.wasiAdapter ? [['wasm-tools', 'parse', source, '-o', artifact.replace('.wasm', '.core.wasm')], ['wasm-tools', 'component', 'new', artifact.replace('.wasm', '.core.wasm'), '--adapt', 'wasi_snapshot_preview1=<pinned-command-adapter>', '-o', artifact]] : [['wasm-tools', 'parse', source, '-o', artifact]], feature: fixture.feature, variant: fixture.name,
      baseline: fixture.baseline || false, scope: fixture.scope,
      ...(fixture.wasiAdapter ? { adapter: { repository: 'bytecodealliance/wasmtime', version: '46.0.1', revision: adapter.revision, rust: adapter.rust, recipe: 'scripts/feature-adapter-source.mjs', recipeSha256: adapter.recipeSha256, sha256: adapterSha, license: 'Apache-2.0 WITH LLVM-exception' } } : {}) };
    recipes.push(recipe);
    for (const size of fixture.sizes) {
      workloads.push({ schema: 1, id: `features/${fixture.feature}/${fixture.name}/${size}`, family: 'features',
        artifact, sha256, abi: fixture.abi || 'core', features: [fixture.feature], export: fixture.export ?? 'benchmark',
        args: fixture.args ? fixture.args(size) : [fixture.abi === 'component' ? String(size) : size],
        work_unit: fixture.workUnit || 'feature_operation', units_per_invocation: fixture.units || size,
        reset: fixture.reset, oracle: fixture.oracle ? fixture.oracle(size) : { kind: 'exact_u64', expected: [fixture.abi === 'component' ? String(fixture.expected(size)) : fixture.expected(size)] },
        license: fixture.wasiAdapter ? 'MIT AND Apache-2.0 WITH LLVM-exception' : 'MIT', source, generator: 'wasm-fyi-feature-corpus-v1', dimension: fixture.dimension || 'operations', size: fixture.size || size,
        ...(fixture.hostProfile ? { host_profile: fixture.hostProfile } : {}),
        ...(fixture.command ? { command: fixture.command(size) } : {}),
        provenance: { feature: fixture.feature, baseline: fixture.baseline || false, scope: fixture.scope,
          recipe, oraclePolicy: 'independent deterministic arithmetic or exact stream digest; never inferred from measured runtime output' } });
    }
  }
  if (failures.length) throw new Error('Invalid feature artifacts: ' + failures.join(', '));
  await writeFile(manifest, JSON.stringify(workloads, null, 2) + '\n');
  const covered = new Set(recipes.filter(r => !r.baseline).map(r => r.feature));
  const missing = featureIds.filter(id => !covered.has(id));
  if (missing.length) throw new Error('Missing feature coverage: ' + missing.join(', '));
  const rebuildThreads=!requested||chosen.some(f=>f.feature==='threads');
  if(rebuildThreads)command(compilerBinary,['parse',join(root,'sources/threads-workers.wat'),'-o',join(root,'artifacts/threads-workers.wasm')]);
  if(rebuildThreads)command(compilerBinary,['validate','--features','all',join(root,'artifacts/threads-workers.wasm')]);
  await writeFile(join(root, 'build.json'), JSON.stringify({ schema: 1, compiler, generator: 'wasm-fyi-feature-corpus-v1',
    threadWorkers: { source:'sources/threads-workers.wat',sourceSha256:digest(await readFile(join(root,'sources/threads-workers.wat'))), artifact:'artifacts/threads-workers.wasm',artifactSha256:digest(await readFile(join(root,'artifacts/threads-workers.wasm'))),compiler,argv:['wasm-tools','parse','sources/threads-workers.wat','-o','artifacts/threads-workers.wasm'],cases:32 },
    expectedFeatures: featureIds, coveredFeatures: [...covered], missingFeatures: featureIds.filter(id => !covered.has(id)),
    workloadContracts: workloads.length, recipes }, null, 2) + '\n');
  console.log(`Built ${recipes.length} artifacts and ${workloads.length} contracts; ${covered.size}/${featureIds.length} feature families.`);
} else if (action === 'check') {
  const { root:harnessRoot, settings, run } = await harness();
  await prepareFeatureTools(harnessRoot,settings,(process.env.WASMBENCH_RUNTIMES || featureConfigurations(settings).join(',')).split(','));
  const id = 'features-check-' + new Date().toISOString().replace(/[:.]/g, '-');
  const output = join(site, '.wasmbench/experiments', id);
  try { process.stdout.write(run('check', '--suite', manifest, '--runtimes', process.env.WASMBENCH_RUNTIMES || featureConfigurations(settings).join(','),
    '--scenarios', 'compile,first-call,steady', '--validation-profile', 'all', '--launches', '1', '--samples', '1', '--operations', '1', '--warmup', '0',
    '--timeout', settings.collection.timeout, '--out', output)); } catch (error) {
    if (process.env.WASMBENCH_RECORD_FAILURES !== '1') throw error;
    process.stdout.write(run('verify', '--run', output));
    console.log('Feature correctness failures retained as explicit outcomes.');
  }
  await mkdir(join(site, '.wasmbench'), { recursive: true });
  await writeFile(join(site, '.wasmbench/latest-feature-check.txt'), output + '\n');
} else throw new Error('Usage: feature-corpus.mjs build|check');
