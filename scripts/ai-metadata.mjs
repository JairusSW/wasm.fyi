import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { site } from './lib/wasmbench.mjs';
import { AI_PATH, renderAiMetadata, sha256 } from './lib/ai-metadata.mjs';

export async function expectedAiMetadata() {
  const [viewBytes, featureBytes] = await Promise.all([
    readFile(join(site, 'src/lib/data/measurements.json')),
    readFile(join(site, 'static/wasmbench/feature-support.json'))
  ]);
  return renderAiMetadata(JSON.parse(viewBytes), JSON.parse(featureBytes), {
    base: process.env.BASE_PATH || '', sourceSha256: sha256(viewBytes), featuresSha256: sha256(featureBytes)
  });
}

export async function checkAiMetadata(directory, artifacts = null) {
  artifacts ??= await expectedAiMetadata();
  for (const [path, expected] of artifacts) {
    assert.equal(await readFile(join(directory, path), 'utf8'), expected, `Missing or stale machine-readable artifact: ${path}`);
  }
  async function inventory(relative) {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    const paths = await Promise.all(entries.map(entry => entry.isDirectory()
      ? inventory(relative + '/' + entry.name) : [relative + '/' + entry.name]));
    return paths.flat();
  }
  assert.deepEqual((await inventory(AI_PATH)).sort(), [...artifacts.keys()].filter(path => path.startsWith(AI_PATH + '/')).sort(), 'Unexpected machine-readable artifact inventory');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    await checkAiMetadata(join(site, 'build'));
    console.log('Verified all deployed machine-readable artifacts against the current measured view.');
  } else {
    const artifacts = await expectedAiMetadata();
    await rm(join(site, 'static', AI_PATH), { recursive: true, force: true });
    for (const [path, text] of artifacts) {
      const destination = join(site, 'static', path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, text);
    }
    console.log(`Generated ${artifacts.size} machine-readable artifacts from verified site data.`);
  }
}
