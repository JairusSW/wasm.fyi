import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
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
const root = await readFile(join(site, 'build/index.html'), 'utf8');
assert(root.includes('The reference for WebAssembly runtimes.'), 'Homepage was not prerendered');
const pages = await htmlFiles(join(site, 'build'));
for (const path of pages) {
  if (path.endsWith('/404.html')) continue;
  const html = await readFile(path, 'utf8');
  assert(!/<h1[^>]*>500<\/h1>|500 Internal Error/.test(html), `Prerender error: ${path}`);
}
console.log(`Verified ${pages.length} static pages and ${index.reports.length} deployed evidence snapshots.`);
