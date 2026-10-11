import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC_PAGES, SITEMAP_PAGES, publicUrl, renderDiscovery } from './lib/discovery.mjs';

test('discovery is deterministic and describes the current read API without bundled measurements', () => {
 const first = renderDiscovery(), second = renderDiscovery();
 assert.deepEqual(first, second);
 const manifest = JSON.parse(first.get('data/llm/index.json'));
 assert.equal(manifest.kind, 'api-discovery');
 assert.equal(manifest.units.latencyNs, 'nanoseconds per operation');
 assert.equal(manifest.units.peakRssBytes, 'bytes');
 assert.equal(manifest.pagination.records.end, null);
 assert.equal(manifest.pagination.records.maximumLimit, 1000);
 assert.equal(manifest.pagination.compact.maximumLimit, 4096);
 assert.deepEqual(manifest.phases, ['compile', 'instantiate', 'first-call', 'steady']);
 assert.equal(manifest.discovery.platforms, 'https://wasm.fyi/api/platforms');
 for (const path of ['/api/matrix', '/api/timeline', '/api/observation', '/api/history/report']) assert(Object.values(manifest.endpoints).some(url => url.endsWith(path)));
 assert(!('generatedAt' in manifest) && !('latestEvidenceCollectedAt' in manifest));
 assert(first.get('llms-full.txt').length > first.get('llms.txt').length + 1500);
 assert(first.get('llms.txt').includes('nextCursor'));
 assert(first.get('llms-full.txt').includes('nextOffset'));
 assert(first.get('llms-full.txt').includes('If-None-Match'));
 assert(first.get('llms-full.txt').includes('304 has no JSON body'));
 assert(first.get('llms-full.txt').includes('not execution evidence'));
 assert(![...first.keys()].some(path => /benchmarks-|reports.json/.test(path)));
 const inventory = JSON.parse(first.get('data/llm/workloads.json'));
 assert.equal(inventory.kind, 'prepared-workload-inventory');
 assert(inventory.items.length > 100);
 assert(inventory.items.every(item => item.status === 'prepared' && !('latencyNs' in item) && !('capturedAt' in item)));
 assert.equal(manifest.preparedWorkloads, 'https://wasm.fyi/data/llm/workloads.json');
});

test('frontend base paths apply to documents while API URLs remain same-origin root routes', () => {
 const files = renderDiscovery({base:'/wasm.fyi'});
 const manifest = JSON.parse(files.get('data/llm/index.json'));
 assert.equal(manifest.openapi, 'https://wasm.fyi/wasm.fyi/schemas/api-v1.openapi.json');
 assert.equal(manifest.documentation, 'https://wasm.fyi/wasm.fyi/docs/');
 assert.equal(manifest.discovery.summary, 'https://wasm.fyi/api/summary');
 assert(files.get('robots.txt').includes('Sitemap: https://wasm.fyi/wasm.fyi/sitemap.xml'));
 const urls = [...files.get('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
 assert.deepEqual(urls, SITEMAP_PAGES.map(path => publicUrl(path, '/wasm.fyi')));
 assert(urls.some(url => url.endsWith('/compare/')));
 assert(urls.some(url => url.endsWith('/docs/')));
 assert(urls.every(url => !/dashboard|health|api\/|llms/.test(url)));
});

test('invalid deployment base paths cannot inject crawler documents', () => {
 for (const base of ['//evil.test', '/site/', '/a/../b', '/x?y', '/x\nUser-agent: *']) assert.throws(() => renderDiscovery({base}), /Invalid BASE_PATH/);
});
