import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { command, digest, exists, harness, site } from './lib/wasmbench.mjs';
import { prepareCorpus } from './lib/corpus.mjs';

const { settings, run } = await harness();
const id = 'wat-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
const directory = join(site, '.wasmbench/source-builds', id);
const imported = await prepareCorpus(settings, run, join(directory, 'upstream'));
const workloads = JSON.parse(await readFile(imported, 'utf8'));
const compiler = command('wat2wasm', ['--version']).toString().trim();
await mkdir(join(directory, 'sources'), { recursive: true });
await mkdir(join(directory, 'artifacts'), { recursive: true });
const rebuilt = [];
const recipes = [];
const artifacts = new Map();
for (const workload of workloads) {
  const name = workload.id.split('/')[1];
  const wat = join(site, 'corpora/upstream/wago/corpus/sources/wat', name + '.wat');
  if (!await exists(wat)) continue;
  if (!artifacts.has(name)) {
    const input = join(directory, 'sources', name + '.wat');
    const output = join(directory, 'artifacts', name + '.wasm');
    await cp(wat, input);
    command('wat2wasm', [input, '-o', output]);
    const sourceSha256 = digest(await readFile(input));
    const artifactSha256 = digest(await readFile(output));
    const recipe = { name, compiler: { name: 'wat2wasm', version: compiler }, sourceSha256, artifactSha256,
      argv: ['wat2wasm', `sources/${name}.wat`, '-o', `artifacts/${name}.wasm`] };
    artifacts.set(name, { output, recipe });
    recipes.push(recipe);
  }
  const { output, recipe } = artifacts.get(name);
  rebuilt.push({ ...workload, id: 'source/' + workload.id, artifact: output, sha256: recipe.artifactSha256,
    generator: 'wasm-fyi-wago-wat-source-v1', source: `sources/${name}.wat`,
    provenance: { ...workload.provenance, rebuild: recipe } });
}
if (!rebuilt.length) throw new Error('No selected Wago WAT sources found');
const suite = join(directory, 'source-suite.json');
await writeFile(suite, JSON.stringify(rebuilt, null, 2) + '\n');
await writeFile(join(directory, 'build-recipes.json'), JSON.stringify({ schema: 1, recipes }, null, 2) + '\n');
await writeFile(join(site, '.wasmbench/latest-source-suite.txt'), suite + '\n');
console.log(`Compiled ${artifacts.size} Wago WAT sources into ${rebuilt.length} exact workload contracts at ${suite}`);
if (process.argv.includes('--check')) {
  process.stdout.write(run('check', '--suite', suite, '--runtimes', process.env.WASMBENCH_RUNTIMES || settings.collection.runtimes.join(','),
    '--scenarios', 'first-call,steady', '--launches', '1', '--samples', '1', '--operations', '1', '--warmup', '0', '--timeout', settings.collection.timeout,
    '--out', join(site, '.wasmbench/experiments', 'source-check-' + id)));
}
