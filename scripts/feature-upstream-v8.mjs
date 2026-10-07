// Untimed positive semantic checks against real Wasm JS-string builtins.
// No JavaScript polyfill, V8-private intrinsics, or benchmark timing is used.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command, digest, site } from './lib/wasmbench.mjs';
import { featureCompiler } from './lib/feature-toolchain.mjs';

const root = join(site, 'corpora/features');
const adapter = 'upstream-adapters/v8-js-string';
const operations = new Map([
  ['cast', 1], ['test', 1], ['substring', 3], ['length', 1],
  ['concat', 2], ['equals', 2], ['charCodeAt', 2],
]);
const compileOptions = { builtins: ['js-string'], importedStringConstants: 'strings' };

export async function buildAdapter() {
  const compiler = await featureCompiler();
  const version = command(compiler, ['--version']).toString().trim();
  if (!/^wasm-tools 1\.260\.0\b/.test(version)) throw Error('Adapter build requires wasm-tools 1.260.0');
  const source = `${adapter}.wat`, artifact = `${adapter}.wasm`;
  command(compiler, ['parse', join(root, source), '-o', join(root, artifact)]);
  command(compiler, ['validate', '--features', 'all', join(root, artifact)]);
  const recipe = {
    schema: 1, source, artifact, compiler: version, license: 'MIT', timing: false,
    sourceSha256: digest(await readFile(join(root, source))),
    artifactSha256: digest(await readFile(join(root, artifact))),
    argv: [['wasm-tools', 'parse', source, '-o', artifact], ['wasm-tools', 'validate', '--features', 'all', artifact]],
    hostProfile: 'js-string-builtins-v1', compileOptions,
    purpose: 'Original adapter for attributed selected positive upstream semantic vectors; not a timed performance workload',
  };
  await writeFile(join(root, `${adapter}.build.json`), JSON.stringify(recipe, null, 2) + '\n');
  return recipe;
}

// Compile errors or ignored builtin options indicate missing engine support.
// Once admitted, traps and wrong values are correctness failures, never skips.
export async function executeVectors(bytes, vectors, wasm = WebAssembly) {
  for (const [index, c] of vectors.entries()) {
    if (!operations.has(c.operation) || !Array.isArray(c.args) || c.args.length !== operations.get(c.operation)) {
      throw Error(`Unsupported vector shape at case ${index}`);
    }
    if (typeof c.expected !== 'string' && !Number.isInteger(c.expected)) throw Error(`Unsupported expected value at case ${index}`);
  }
  const unavailable = reason => vectors.map((c, index) => ({ index, operation: c.operation, status: 'unavailable', reason }));
  let module;
  try { module = await wasm.compile(bytes, compileOptions); }
  catch (error) {
    if (error instanceof WebAssembly.CompileError) return unavailable(error.message);
    throw error;
  }
  if (wasm.Module.imports(module).length) return unavailable('Engine did not resolve the requested wasm:js-string builtins; no polyfill supplied');
  let instance;
  try { instance = await wasm.instantiate(module, {}); }
  catch (error) {
    return vectors.map((c, index) => ({ index, operation: c.operation, status: 'failed', reason: error.message }));
  }
  return vectors.map((c, index) => {
    try {
      if (typeof instance.exports[c.operation] !== 'function') throw Error('Adapter export missing');
      for (let repeat = 0; repeat < 3; repeat++) {
        const actual = instance.exports[c.operation](...c.args);
        if (!Object.is(actual, c.expected)) throw Error(`Expected ${JSON.stringify(c.expected)}, received ${JSON.stringify(actual)}`);
      }
      return { index, operation: c.operation, status: 'verified', repetitions: 3 };
    } catch (error) {
      return { index, operation: c.operation, status: 'failed', reason: error.message };
    }
  });
}

export async function checkUpstreamV8({ build = false } = {}) {
  if (build) await buildAdapter();
  const index = JSON.parse(await readFile(join(root, 'upstream/index.json'), 'utf8'));
  const source = index.sources.find(item => item.id === 'v8-imported-strings');
  if (!source || source.kind !== 'portable-semantic-vectors' || source.localPath !== 'vectors/v8-js-string-positive.json') {
    throw Error('Missing selected V8 string source');
  }
  const vectorBytes = await readFile(join(root, 'upstream', source.localPath));
  if (digest(vectorBytes) !== source.localSha256) throw Error('V8 vector source digest mismatch');
  const vectors = JSON.parse(vectorBytes);
  if (vectors.schema !== 1 || vectors.source !== source.id || vectors.hostProfile !== 'js-string-builtins-v1' || vectors.cases.length !== source.cases) {
    throw Error('V8 vector source metadata mismatch');
  }
  const recipe = JSON.parse(await readFile(join(root, `${adapter}.build.json`), 'utf8'));
  if (recipe.schema !== 1 || recipe.source !== `${adapter}.wat` || recipe.artifact !== `${adapter}.wasm` || !/^wasm-tools 1\.260\.0\b/.test(recipe.compiler)) {
    throw Error('Unexpected V8 adapter recipe');
  }
  if (digest(await readFile(join(root, recipe.source))) !== recipe.sourceSha256) throw Error('V8 adapter source digest mismatch');
  const bytes = await readFile(join(root, recipe.artifact));
  if (digest(bytes) !== recipe.artifactSha256) throw Error('V8 adapter artifact digest mismatch');
  const outcomes = await executeVectors(bytes, vectors.cases);
  return {
    schema: 1, timing: false, engine: { node: process.version, v8: process.versions.v8 },
    source: { id: source.id, upstreamUrl: source.upstreamUrl, revision: source.revision, localSha256: source.localSha256 },
    adapter: recipe, outcomes,
  };
}

async function main() {
  const report = await checkUpstreamV8({ build: process.argv.includes('--build') });
  await mkdir(join(site, '.wasmbench'), { recursive: true });
  await writeFile(join(site, '.wasmbench/feature-upstream-v8.json'), JSON.stringify(report, null, 2) + '\n');
  for (const outcome of report.outcomes.filter(o => o.status !== 'verified')) {
    console.log(outcome.status, outcome.operation, outcome.index, outcome.reason);
  }
  const count = status => report.outcomes.filter(o => o.status === status).length;
  console.log(`Selected V8 string vectors: ${count('verified')} verified, ${count('unavailable')} unavailable, ${count('failed')} failed; all checks untimed.`);
  if (count('failed') || (process.argv.includes('--require-all') && count('unavailable'))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
