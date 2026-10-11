import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { SITEMAP_PAGES, publicUrl, renderDiscovery } from './lib/discovery.mjs';

const root = resolve(process.env.WASMFYI_FRONTEND_OUTPUT || 'build');
const base = process.env.BASE_PATH || '';
const names = await readdir(root);
for (const name of names) assert(name !== 'wasmbench' && !name.includes('.previous-') && !name.startsWith('.static-data-'), 'Frontend build contains a measurement dataset or private backup');
async function files(directory) {
 const output = [];
 for (const entry of await readdir(directory, { withFileTypes: true })) {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) output.push(...await files(path)); else output.push(path);
 }
 return output;
}
const paths = await files(root), html = paths.filter(path => path.endsWith('.html'));
assert(names.includes('404.html'), 'Missing application shell for newly imported workloads');
assert(names.includes('index.html'), 'Missing prerendered homepage');
for (const path of html) {
 const body = await readFile(path, 'utf8');
 assert(!/<h1[^>]*>500<\/h1>|500 Internal Error/.test(body), `Prerender error: ${path}`);
 if (path.endsWith('/404.html')) continue;
 assert(/<title>[^<]+<\/title>/.test(body), `Missing title: ${path}`);
 assert.equal([...body.matchAll(/<meta name="description" content="[^"]+"/g)].length, 1, `Missing description: ${path}`);
 assert(body.includes('/data/llm/index.json'), `Missing API discovery link: ${path}`);
 assert(body.includes('/schemas/api-v1.openapi.json'), `Missing OpenAPI link: ${path}`);
 assert(!body.includes('/api/v1/manifest'), `Retired API discovery: ${path}`);
 const canonical = /<link rel="canonical" href="([^"]+)"/.exec(body)?.[1];
 assert.equal(canonical, publicUrl(relative(root, path).replace(/index\.html$/, ''), base), `Wrong canonical URL: ${path}`);
 if (!path.endsWith('/dashboard/index.html')) {
  const json = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(body)?.[1];
  assert(json, `Missing structured page identity: ${path}`);
  assert.equal(JSON.parse(json).url, canonical);
 }
}
for (const [path, expected] of renderDiscovery({base})) assert.equal(await readFile(join(root, path), 'utf8'), expected, `Stale discovery: ${path}`);
const dataFiles = await files(join(root, 'data'));
assert.deepEqual(dataFiles.map(path => relative(root, path)), ['data/llm/index.json', 'data/llm/workloads.json'], 'Unexpected copied measurement data');
for (const path of SITEMAP_PAGES) assert((await stat(join(root, path, 'index.html'))).isFile(), `Missing sitemap page: ${path}`);
const inventory = JSON.parse(await readFile(join(root, 'data/llm/workloads.json'), 'utf8'));
assert.equal(inventory.kind, 'prepared-workload-inventory');
for (const workload of inventory.items) {
 const page = await readFile(join(root, new URL(workload.page).pathname.slice(base.length), 'index.html'), 'utf8');
 assert(page.includes(workload.artifactSha256), `Missing prepared artifact metadata: ${workload.id}`);
 assert(page.includes('Prepared corpus contract'), `Missing inventory qualification: ${workload.id}`);
}
const docs = await readFile(join(root, 'docs/index.html'), 'utf8');
assert(docs.includes('Read the measurements. Keep the context.') && docs.includes('latencyNs') && docs.includes('nextCursor'), 'API guide must be readable before JavaScript');
assert.equal(await readFile(join(root, 'reference.md'), 'utf8'), await readFile('API.md', 'utf8'), 'Stale full HTTP reference');
// Every external JSON Schema reference is packaged beside the OpenAPI document.
const checked = new Set();
async function checkRefs(path) {
 if (checked.has(path)) return;
 checked.add(path);
 const parsed = JSON.parse(await readFile(path, 'utf8'));
 for (const match of JSON.stringify(parsed).matchAll(/"\$ref":"([^"#]+)(?:#[^"]*)?"/g)) {
  if (/^https?:/.test(match[1])) continue;
  const target = resolve(dirname(path), match[1]);
  assert(target.startsWith(root + '/schemas/'), 'Schema reference leaves published schema directory');
  await checkRefs(target);
 }
}
await checkRefs(join(root, 'schemas/api-v1.openapi.json'));
for (const path of ['dashboard', 'health']) assert((await readFile(join(root, path, 'index.html'), 'utf8')).includes('name="robots" content="noindex"'), `Operational page must be noindex: ${path}`);
let largest = 0;
for (const path of paths.filter(path => path.endsWith('.js'))) {
 const body = await readFile(path);
 assert(!body.includes(Buffer.from('indexed-cells-v1')), 'Legacy measurement corpus found in client JavaScript');
 largest = Math.max(largest, brotliCompressSync(body).length);
}
assert(largest <= 200 * 1024, `Client chunk exceeds compressed build budget: ${largest}`);
console.log(`Verified ${html.length} prerendered pages, ${checked.size} schema documents, deterministic discovery and no bundled measurements; largest compressed JavaScript chunk ${largest} bytes.`);
