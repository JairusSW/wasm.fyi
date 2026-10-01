import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stageAuxiliary } from './lib/auxiliary-data.mjs';
import { featureSupport } from './lib/feature-support.mjs';
import { site, digest } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';
async function htmlFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await htmlFiles(path));
    else if (entry.name.endsWith('.html')) paths.push(path);
  }
  return paths;
}
const index = await validateData(join(site, 'build/wasmbench'));
const source = await validateData(join(site, 'data/wasmbench'));
assert.deepEqual(index, source, 'Build contains stale benchmark snapshots');
for (const r of index.reports) assert.equal(digest(await readFile(join(site, 'build/wasmbench', r.evidence))), r.evidenceSha256);
assert.deepEqual(JSON.parse(await readFile(join(site,'build/wasmbench/feature-support.json'),'utf8')),await featureSupport(join(site,'data/wasmbench'),source.reports),'Stale feature support matrix');
const expectedAux=await mkdtemp(join(tmpdir(),'wasm-fyi-build-aux-'));
try {
  await stageAuxiliary(expectedAux);
  async function compare(directory,relative='') {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path=relative?relative+'/'+entry.name:entry.name;
      if(entry.isDirectory()) await compare(join(directory,entry.name),path);
      else assert.equal(digest(await readFile(join(directory,entry.name))),digest(await readFile(join(site,'build/wasmbench',path))),`Stale auxiliary evidence: ${path}`);
    }
  }
  await compare(expectedAux);
} finally {await rm(expectedAux,{recursive:true,force:true});}
const root = await readFile(join(site, 'build/index.html'), 'utf8');
assert(root.includes('The reference for WebAssembly runtimes.'), 'Homepage was not prerendered');
const pages = await htmlFiles(join(site, 'build'));
for (const path of pages) {
  if (path.endsWith('/404.html')) continue;
  const html = await readFile(path, 'utf8');
  assert(!/<h1[^>]*>500<\/h1>|500 Internal Error/.test(html), `Prerender error: ${path}`);
}
console.log(`Verified ${pages.length} static pages and ${index.reports.length} deployed evidence snapshots.`);
