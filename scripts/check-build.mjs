import { checkAiMetadata } from './ai-metadata.mjs';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { siteUrl } from './lib/ai-metadata.mjs';
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
assert(!(await readdir(join(site,'build'))).some(name=>name.includes('.previous-') || name.startsWith('.static-data-')), 'Build contains private transactional evidence backups');
const index = await validateData(join(site, 'build/wasmbench'));
assert.equal(digest(await readFile(join(site,'build/wasmbench/corpus-catalog.json'))),digest(await readFile(join(site,'corpora/catalog.json'))),'Stale prepared corpus inventory');
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
await checkAiMetadata(join(site, 'build'));
const root = await readFile(join(site, 'build/index.html'), 'utf8');
assert(root.includes('The reference for WebAssembly runtimes.'), 'Homepage was not prerendered');
const pages = await htmlFiles(join(site, 'build'));
const buildRoot = join(site, 'build');
const publicRoot = siteUrl('', process.env.BASE_PATH || '');
async function checkPublicLink(href, from = publicRoot) {
  const url = new URL(href, from);
  assert(url.href.startsWith(publicRoot), `Link leaves configured public root: ${url}`);
  const pathname = decodeURIComponent(url.pathname.slice(new URL(publicRoot).pathname.length));
  const target = resolve(buildRoot, pathname, url.pathname.endsWith('/') ? 'index.html' : '');
  assert(target.startsWith(buildRoot + '/'), `Unsafe output link: ${url}`);
  assert((await stat(target)).isFile(), `Missing output link: ${url}`);
}
const sitemap = await readFile(join(buildRoot, 'sitemap.xml'), 'utf8');
for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) await checkPublicLink(match[1].replaceAll('&amp;', '&'));
for (const path of pages) {
  if (path.endsWith('/404.html')) continue;
  if (path.includes('/wasmbench/code-inspection/')) continue;
  const html = await readFile(path, 'utf8');
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  assert.equal(canonical, new URL(relative(buildRoot, path).replace(/index\.html$/, ''), publicRoot).href, `Wrong canonical URL: ${path}`);
  const alternateLinks = [...html.matchAll(/<link rel="alternate"[^>]+href="([^"]+)"/g)];
  assert.equal(alternateLinks.length, 3, `Missing machine discovery links: ${path}`);
  for (const [, href] of alternateLinks) await checkPublicLink(href, canonical);
  assert(!/<h1[^>]*>500<\/h1>|500 Internal Error/.test(html), `Prerender error: ${path}`);
}
console.log(`Verified ${pages.length} static pages and ${index.reports.length} deployed evidence snapshots.`);
