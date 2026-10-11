import assert from 'node:assert/strict';
import { listPreparedWorkloads, PREPARED_CATALOG_POLICY, PREPARED_CATALOG_SOURCE } from '../../src/lib/server/prepared-workloads.ts';
import { SITE_ORIGIN, SITE_DESCRIPTION } from '../../src/lib/site.ts';

export const PUBLIC_PAGES = ['', 'benchmarks/', 'compare/', 'history/', 'features/', 'simd/', 'gc/', 'memory64/', 'threads/', 'docs/', 'workloads/'];
export const SITEMAP_PAGES = [...PUBLIC_PAGES, ...listPreparedWorkloads().map(workload => workload.path.slice(1))];
export function publicUrl(path = '', base = '') {
  assert(base === '' || /^\/(?!\/)[A-Za-z0-9_./-]+$/.test(base) && !base.endsWith('/') && !base.split('/').includes('..'), 'Invalid BASE_PATH');
  return `${SITE_ORIGIN}${base}/${path.replace(/^\//, '')}`;
}

export const INTERPRETATION = [
  'API latencyNs is median nanoseconds per operation; peakRssBytes and codeBytes are bytes. The UI may format them in different units.',
  'Only status ok has a numeric value. Failed, unsupported, disabled and not-measured values are null. Missing records are not zero or proof of unsupported behavior.',
  'Compare the same platform, artifactSha256, contractSha256, phase, engine configuration and sampling policy. Inspect source revision, backend, capturedAt and display metadata before drawing conclusions.',
  'Current results select the latest qualified source snapshot per engine. Missing cells stay missing. History source.asOf is the source target date; capturedAt is the actual measurement time.',
  'The adaptive sampling rule measures repeatability within a persistent process, not an independent-launch confidence interval. Read sampling and ordered samplesNs on observation detail; older records retain their own policy.',
  'Peak RSS is a process high-water mark, not heap allocation or a phase delta. codeKind distinguishes native-image, engine-reported and legacy unknown sizes; do not equate different definitions.',
  'Feature probes cover their exact workload contracts, not full specification conformance or browser support. No universal fastest runtime follows from incomplete or unmatched coverage.',
  'The active API retains measurements, metadata and timing samples, not execution evidence, report archives or Wasm binaries. Capture receipts are not downloadable reports.'
];

export function renderDiscovery({ base = '' } = {}) {
  const url = path => publicUrl(path, base);
  // The deployed API is rooted at the origin, also for a BASE_PATH frontend.
  const api = path => SITE_ORIGIN + path;
  const manifest = {
    schemaVersion: 1, kind: 'api-discovery', name: 'wasm.fyi', description: SITE_DESCRIPTION,
    website: url(''), documentation: url('docs/'), reference: url('reference.md'),
    openapi: url('schemas/api-v1.openapi.json'), recordSchema: url('schemas/benchmark.schema.json'),
    preparedWorkloads: url('data/llm/workloads.json'), workloadCatalog: url('workloads/'),
    llms: url('llms.txt'), fullReference: url('llms-full.txt'),
    apiOrigin: SITE_ORIGIN, authentication: 'Public reads need no authentication. Capture publication requires an administrator token.',
    discovery: { platforms: api('/api/platforms'), summary: api('/api/summary') },
    endpoints: {
      benchmarks: api('/api/benchmarks'), history: api('/api/history'), matrix: api('/api/matrix'), timeline: api('/api/timeline'),
      observation: api('/api/observation'), overview: api('/api/overview'), aggregates: api('/api/aggregates'),
      historySummary: api('/api/history/summary'), historyComparison: api('/api/history/comparison'), historyReport: api('/api/history/report')
    },
    phases: ['compile', 'instantiate', 'first-call', 'steady'],
    units: { latencyNs: 'nanoseconds per operation', peakRssBytes: 'bytes', codeBytes: 'bytes' },
    statuses: ['ok', 'failed', 'unsupported', 'disabled', 'not-measured'],
    pagination: {
      records: { routes: ['/api/benchmarks', '/api/history'], defaultLimit: 200, maximumLimit: 1000, next: 'nextCursor', end: null,
        resume: 'Pass cursor unchanged and URL-encoded. Keep filters consistent. A 409 revision_changed requires restarting the traversal.' },
      compact: { routes: ['/api/matrix', '/api/timeline'], maximumLimit: 4096, next: 'nextOffset', end: null,
        resume: 'Pass offset=nextOffset and revision from the first page, retaining the same scope. Restart on HTTP 409.' }
    },
    caching: 'Use ETag with If-None-Match for unchanged public GET resources. A 304 has no JSON body. Respect Retry-After on 429.',
    interpretation: INTERPRETATION,
    source: 'https://github.com/JairusSW/wasm.fyi',
    notes: ['This is a navigation manifest, not a snapshot of measured results. Follow live API revisions for data freshness.',
      'The old /api/v1/* and static benchmark shards are retired; they have no compatibility aliases.']
  };
  const short = `# wasm.fyi\n\n> ${SITE_DESCRIPTION}\n\nPublic WebAssembly benchmark data and interpretation, with no JavaScript or API key required for reads.\n\n## Start here\n\n- [API and measurement guide](${url('docs/')})\n- [Machine-readable discovery](${url('data/llm/index.json')})\n- [OpenAPI 3.1 contract](${url('schemas/api-v1.openapi.json')})\n- [Full HTTP reference](${url('reference.md')})\n- [Expanded LLM reference](${url('llms-full.txt')})\n- [Prepared workload catalog](${url('workloads/')})\n- [Prepared workload metadata JSON](${url('data/llm/workloads.json')})\n- [Measured platforms](${api('/api/platforms')})\n- [Counts and freshness](${api('/api/summary')})\n\n## Read results\n\n1. GET /api/platforms and select an actual items[].id. Never invent a platform ID.\n2. GET /api/benchmarks?platform=ID&phase=steady&limit=20.\n3. Follow nextCursor as an opaque, URL-encoded cursor until null. Restart on HTTP 409.\n4. Use /api/history for source-pinned history and /api/observation for full ordered samples.\n\n## Interpretation\n\n${INTERPRETATION.map(note => '- ' + note).join('\n')}\n\nUse conditional GETs and bounded pages. Respect HTTP 429 Retry-After. Never publish captures while exploring data. Cite the full query, platform, returned revision and observation/source identities; a canonical landing-page URL alone does not identify measurements.\n`;
  const full = short + `\n## Query and response details\n\n/api/benchmarks and /api/history require platform on the first request. phase defaults to steady; phases are compile, instantiate, first-call and steady. limit defaults to 200 and ranges from 1 to 1000. Results contain revision, platform, phase, items, total and nextCursor. A null nextCursor ends pagination. History and current cursors are not interchangeable.\n\n/api/matrix and /api/timeline provide compact scalar rows with shared contract/configuration/source dictionaries. Follow nextOffset using the same filters and revision, until null; limit ranges from 1 to 4096. /api/timeline supports inclusive from/to source dates. Decode each schema-2 row using the HTTP reference, not guessed array positions.\n\n/api/observation?platform=ID&id=OBSERVATION_ID returns a detailed observation with ordered samplesNs. IDs are database-local, not source commits. An optional asOf identifies a weekly alias source.\n\n/api/overview returns engine/phase arithmetic means. /api/aggregates supports explicit engine, baseline, weighting, cohort and averaging scopes. Features and host-call mechanisms do not enter main workload averages. Aggregates must be cited with their full comparison scope.\n\n/api/history/summary, /api/history/comparison and /api/history/report provide compact graph, matched-cohort comparison and per-workload reporting respectively. Date windows refer to UTC source dates, not capture dates. See the linked OpenAPI and HTTP reference for parameters and exact shapes.\n\nPublic errors use {"error":{"code":"...","message":"..."}}. Handle 400 (invalid query), 404 (unknown route/platform/observation), 405 (unsupported method), 409 (revision changed), 429 (request budget), and 503 (temporary failure). A 304 has no JSON body. Error bodies and 304 responses are not successful measurement pages.\n\nThe platform catalog revision is global; result-page revisions are scoped. Do not substitute one for the other. Never combine pages across changed revisions. Cache using the response ETag for that exact URL and send If-None-Match; do not repeatedly download all observations when scalar summaries suffice.\n\n## Public pages\n\n${PUBLIC_PAGES.map(path => '- ' + url(path)).join('\n')}\n\n## Publication and provenance\n\nDiscovery files are generated deterministically from repository documentation and schemas, without fetching measurements or adding build timestamps. They do not claim that a dataset is current. Check live revision, capture timestamps, exact runtime/source and workload hashes in API results. No data license, search ranking, indexing inclusion or crawler usage is implied.\n\nThe /api/captures write endpoint is administrator-only. This reference is for public read-only exploration; no sign-in or credential is needed for that workflow.\n`;
  const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return new Map([
    ['llms.txt', short], ['llms-full.txt', full],
    ['data/llm/index.json', JSON.stringify(manifest, null, 2) + '\n'],
    ['data/llm/workloads.json', JSON.stringify({schemaVersion: 1, kind: 'prepared-workload-inventory', policy: PREPARED_CATALOG_POLICY, source: PREPARED_CATALOG_SOURCE, items: listPreparedWorkloads().map(({path, ...workload}) => ({...workload, page: url(path)}))}, null, 2) + '\n'],
    ['robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${url('sitemap.xml')}\n# API guide: ${url('docs/')}\n# LLM reference: ${url('llms.txt')}\n# API discovery: ${url('data/llm/index.json')}\n`],
    ['sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${SITEMAP_PAGES.map(path => `  <url><loc>${xml(url(path))}</loc></url>`).join('\n')}\n</urlset>\n`]
  ]);
}
