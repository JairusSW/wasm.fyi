import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixtures, featureIds } from '../corpora/features/generator.mjs';
import { sourceAdapter } from './feature-adapter-source.mjs';
import { featureCompiler } from './lib/feature-toolchain.mjs';
import {validateProposalArtifact} from './lib/proposal-validation.mjs';
import {proposalBinaryBytes} from '../corpora/features/proposal-binary.mjs';
import { prepareFeatureTools } from './lib/feature-tools.mjs';
import { featureConfigurations } from './lib/feature-configurations.mjs';
import { command, digest, harness, site } from './lib/wasmbench.mjs';

const action = process.argv[2] || 'build';
const outputDirectory=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
const root = outputDirectory?resolve(outputDirectory):join(site, 'corpora/features');
const fresh=process.argv.includes('--fresh');
if(fresh&&(!outputDirectory||action!=='build'))throw Error('--fresh requires build --out=<empty-directory>');
if(fresh){
  const {readdir}=await import('node:fs/promises');
  if((await readdir(root).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).length)throw Error('--fresh output directory must be empty');
}
const manifest = join(root, 'manifest.json');
const inventory=fixtures();
// --ids=features/<family>/<name>,… selects contracts; --family=<family>,… selects whole families.
const families=process.argv.find(a=>a.startsWith('--family='))?.slice(9).split(',').filter(Boolean);
if(families?.some(f=>!featureIds.includes(f)))throw Error('Unknown feature family: '+families.filter(f=>!featureIds.includes(f)).join(', '));
const requested=process.argv.find(a=>a.startsWith('--ids='))?.slice(6).split(',')
  ?? (families && inventory.filter(f=>families.includes(f.feature)).map(f=>`features/${f.feature}/${f.name}`));
if(requested?.some(id=>!inventory.some(f=>id===`features/${f.feature}/${f.name}`)))throw Error('Unknown feature corpus');
// A shared artifact must never be rebuilt without refreshing all its contracts.
const modules=new Set(inventory.filter(f=>requested?.includes(`features/${f.feature}/${f.name}`)).map(f=>f.module).filter(Boolean));
const chosen=inventory.filter(f=>!requested||requested.includes(`features/${f.feature}/${f.name}`)||modules.has(f.module));
const refreshed=new Set(chosen.map(f=>`features/${f.feature}/${f.name}`));
if (action === 'build') {
  const compilerBinary = await featureCompiler();
  const compiler = command(compilerBinary, ['--version']).toString().trim();
  if (!compiler.startsWith('wasm-tools 1.260.0')) throw new Error('Rebuild requires wasm-tools 1.260.0');
  const adapter = chosen.some(f=>f.wasiAdapter)?await sourceAdapter():{path:null,sha256:null};
  const adapterPath = adapter.path, adapterSha = adapter.sha256;
  const previous=requested&&!fresh?JSON.parse(await readFile(manifest)):[];
  const oldBuild=requested&&!fresh?JSON.parse(await readFile(join(root,'build.json'))):{recipes:[]};
  const workloads = previous.filter(w=>!refreshed.has(w.id.split('/').slice(0,3).join('/'))), recipes = oldBuild.recipes.filter(r=>!refreshed.has(`features/${r.feature}/${r.variant}`)), failures = [];
  await mkdir(join(root, 'sources'), { recursive: true });
  await mkdir(join(root, 'artifacts'), { recursive: true });
  for (const fixture of chosen) {
    const stem = fixture.module || `${fixture.feature}-${fixture.name}`;
    const source = `sources/${stem}.wat`, artifact = `artifacts/${stem}.wasm`;
    await writeFile(join(root, source), fixture.wat.trim() + '\n');
    try {
      if (fixture.wasiAdapter) {
        const core = join(root, 'artifacts', stem + '.core.wasm');
        command(compilerBinary, ['parse', join(root, source), '-o', core]);
        command(compilerBinary, ['component', 'new', core, '--adapt', 'wasi_snapshot_preview1=' + adapterPath, '-o', join(root, artifact)]);
      } else if(fixture.nativeValidation)await writeFile(join(root,artifact),proposalBinaryBytes(fixture.wat));
      else command(compilerBinary, ['parse', join(root, source), '-o', join(root, artifact)]);
      await validateProposalArtifact(compilerBinary, join(root, artifact), fixture);
    } catch {
      failures.push(stem); continue;
    }
    const sha256 = digest(await readFile(join(root, artifact)));
    const recipe = { source, sourceSha256: digest(await readFile(join(root, source))), artifact, sha256,
      compiler:fixture.nativeValidation?'V8 wasm-module-builder@34f4bf16f621ceba505ef2b7b818d48d09a5d3d3':compiler,
      ...(fixture.nativeValidation?{validator:{engine:'V8 15.2.20',flags:fixture.v8Flags,entry:'WebAssembly.Module',policy:'Pinned proposal dialect; wasm-tools does not implement these encodings'}}:{}),
      argv: fixture.nativeValidation?[['node','scripts/feature-corpus.mjs','build',`--ids=features/${fixture.feature}/${fixture.name}`]]:fixture.wasiAdapter ? [['wasm-tools', 'parse', source, '-o', artifact.replace('.wasm', '.core.wasm')], ['wasm-tools', 'component', 'new', artifact.replace('.wasm', '.core.wasm'), '--adapt', 'wasi_snapshot_preview1=<pinned-command-adapter>', '-o', artifact]] : [['wasm-tools', 'parse', source, '-o', artifact]], feature: fixture.feature, variant: fixture.name,
      baseline: fixture.baseline || false, scope: fixture.scope,
      ...(fixture.module ? { module: fixture.module, export: fixture.export } : {}),
      ...(fixture.wasiAdapter ? { adapter: { repository: 'bytecodealliance/wasmtime', version: '46.0.1', revision: adapter.revision, rust: adapter.rust, recipe: 'scripts/feature-adapter-source.mjs', recipeSha256: adapter.recipeSha256, sha256: adapterSha, license: 'Apache-2.0 WITH LLVM-exception' } } : {}) };
    recipes.push(recipe);
    for (const size of fixture.sizes) {
      workloads.push({ schema: 1, id: `features/${fixture.feature}/${fixture.name}/${size}`, family: 'features',
        artifact, sha256, abi: fixture.abi || 'core', features: fixture.features || [fixture.feature], export: fixture.export ?? 'benchmark',
        args: fixture.args ? fixture.args(size) : [fixture.abi === 'component' ? String(size) : size],
        work_unit: fixture.workUnit || 'feature_operation', units_per_invocation: fixture.units || size,
        reset: fixture.reset, oracle: fixture.oracle ? fixture.oracle(size) : { kind: 'exact_u64', expected: [fixture.abi === 'component' ? String(fixture.expected(size)) : fixture.expected(size)] },
        license: fixture.wasiAdapter ? 'MIT AND Apache-2.0 WITH LLVM-exception' : 'MIT', source, generator: 'wasm-fyi-feature-corpus-v1', dimension: fixture.dimension || 'operations', size: fixture.size || size,
        ...(fixture.hostProfile ? { host_profile: fixture.hostProfile } : {}),
        ...(fixture.v8Flags ? {v8Flags: fixture.v8Flags} : {}),
        ...(fixture.retainedRoots?{retainedRoots:fixture.retainedRoots}:{}),
        ...(fixture.initialize ? { initialize: fixture.initialize } : {}),
        ...(fixture.command ? { command: fixture.command(size) } : {}),
        provenance: { feature: fixture.feature, baseline: fixture.baseline || false, scope: fixture.scope,
          ...(fixture.module ? { module: fixture.module, export: fixture.export } : {}),
          recipe, ...(fixture.sources ? { sources: fixture.sources } : {}), oraclePolicy: 'independent deterministic arithmetic or exact stream digest; never inferred from measured runtime output' } });
    }
  }
  if (failures.length) throw new Error('Invalid feature artifacts: ' + failures.join(', '));
  // Write in generator order so a partial rebuild produces the same files as a full one.
  const rank=new Map(inventory.map((f,k)=>[`features/${f.feature}/${f.name}`,k]));
  const at=id=>rank.get(id.split('/').slice(0,3).join('/'))??Infinity;
  workloads.sort((a,b)=>at(a.id)-at(b.id)||(inventory[at(a.id)]?.sizes.indexOf(a.size)??0)-(inventory[at(b.id)]?.sizes.indexOf(b.size)??0));
  recipes.sort((a,b)=>at(`features/${a.feature}/${a.variant}`)-at(`features/${b.feature}/${b.variant}`));
  await writeFile(manifest, JSON.stringify(workloads, null, 2) + '\n');
  const covered = new Set(recipes.filter(r => !r.baseline).map(r => r.feature));
  const expectedFeatures=fresh&&requested?[...new Set(chosen.filter(f=>!f.baseline).map(f=>f.feature))]:featureIds;
  const missing = expectedFeatures.filter(id => !covered.has(id));
  if (missing.length) throw new Error('Missing feature coverage: ' + missing.join(', '));
  const rebuildThreads=!requested||chosen.some(f=>f.feature==='threads');
  if(rebuildThreads&&outputDirectory)await writeFile(join(root,'sources/threads-workers.wat'),await readFile(join(site,'corpora/features/sources/threads-workers.wat')));
  if(rebuildThreads)command(compilerBinary,['parse',join(root,'sources/threads-workers.wat'),'-o',join(root,'artifacts/threads-workers.wasm')]);
  if(rebuildThreads)command(compilerBinary,['validate','--features','all',join(root,'artifacts/threads-workers.wasm')]);
  await writeFile(join(root, 'build.json'), JSON.stringify({ schema: 1, compiler, generator: 'wasm-fyi-feature-corpus-v1',
    ...(rebuildThreads||!fresh?{threadWorkers: { source:'sources/threads-workers.wat',sourceSha256:digest(await readFile(join(root,'sources/threads-workers.wat'))), artifact:'artifacts/threads-workers.wasm',artifactSha256:digest(await readFile(join(root,'artifacts/threads-workers.wasm'))),compiler,argv:['wasm-tools','parse','sources/threads-workers.wat','-o','artifacts/threads-workers.wasm'],cases:32 }}:{}),
    expectedFeatures, coveredFeatures: [...covered], missingFeatures: missing,
    workloadContracts: workloads.length, recipes }, null, 2) + '\n');
  console.log(`Built ${new Set(recipes.map(r=>r.artifact)).size} artifacts (${recipes.length} workload recipes) and ${workloads.length} contracts; ${covered.size}/${featureIds.length} feature families.`);
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
} else if (action === 'verify') {
  // Reproducibility from source, without touching the checked-in corpus: regenerate each
  // source from the generator, compile it into a scratch directory with the pinned compiler,
  // and compare both against the committed files and manifest digests.
  const compilerBinary = await featureCompiler();
  const compiler = command(compilerBinary, ['--version']).toString().trim();
  if (!compiler.startsWith('wasm-tools 1.260.0')) throw new Error('Verification requires wasm-tools 1.260.0');
  const contracts = JSON.parse(await readFile(manifest));
  const scratch = await mkdtemp(join(tmpdir(), 'wasm-fyi-features-'));
  const results = new Map();
  try {
    for (const fixture of chosen) {
      const stem = fixture.module || `${fixture.feature}-${fixture.name}`;
      if (results.has(stem)) continue;
      const source = `sources/${stem}.wat`, artifact = `artifacts/${stem}.wasm`;
      const problems = [];
      const committed = await readFile(join(root, source), 'utf8').catch(() => null);
      if (committed === null) problems.push('source missing');
      else if (committed !== fixture.wat.trim() + '\n') problems.push('source differs from generator');
      const built = join(scratch, stem + '.wasm');
      try {
        if(fixture.nativeValidation)await writeFile(built,proposalBinaryBytes(fixture.wat));
        else command(compilerBinary, ['parse', join(root, source), '-o', built]);
        await validateProposalArtifact(compilerBinary, built, fixture);
      }
      catch { problems.push('does not compile'); }
      const sha = problems.includes('does not compile') ? null : digest(await readFile(built));
      const checkedIn = await readFile(join(root, artifact)).then(digest, () => null);
      if (sha && checkedIn !== sha) problems.push(checkedIn ? 'artifact differs from rebuild' : 'artifact missing');
      const listed = contracts.filter(w => w.artifact === artifact);
      if (!listed.length) problems.push('not in manifest');
      if (sha && listed.some(w => w.sha256 !== sha)) problems.push('manifest digest differs from rebuild');
      results.set(stem, { feature: fixture.feature, problems });
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
  const byFamily = new Map();
  for (const r of results.values()) { const f = byFamily.get(r.feature) ?? { ok: 0, bad: [] }; r.problems.length ? f.bad.push(r) : f.ok++; byFamily.set(r.feature, f); }
  for (const [family, f] of byFamily) console.log(`${f.bad.length ? '✕' : '✓'} ${family.padEnd(26)} ${f.ok}/${f.ok + f.bad.length} artifacts reproduce from source`);
  for (const [stem, r] of results) if (r.problems.length) console.log(`  ${stem}: ${r.problems.join('; ')}`);
  const failed = [...results.values()].filter(r => r.problems.length).length;
  console.log(`${results.size - failed}/${results.size} artifacts reproduced byte-for-byte (WAT: ${compiler}${chosen.some(f=>f.nativeValidation)?'; binary proposals: pinned V8 encoder/native validator':''}).`);
  if (failed) process.exitCode = 1;
} else throw new Error('Usage: feature-corpus.mjs build|check|verify [--family=<family>,…] [--ids=features/<family>/<name>,…] [--out=<directory>] [--fresh]');
