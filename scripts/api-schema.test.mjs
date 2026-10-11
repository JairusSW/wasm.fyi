import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const schemaRoot = new URL('../schemas/', import.meta.url);
const documents = new Map(['api-v1.openapi.json', 'benchmark.schema.json', 'compact-api.schema.json']
  .map(name => [new URL(name, schemaRoot).href, JSON.parse(readFileSync(new URL(name, schemaRoot), 'utf8'))]));
const api = documents.get(new URL('api-v1.openapi.json', schemaRoot).href);
const benchmark = documents.get(new URL('benchmark.schema.json', schemaRoot).href).$defs;
const compact = documents.get(new URL('compact-api.schema.json', schemaRoot).href).$defs;
const apiUrl = new URL('api-v1.openapi.json', schemaRoot).href;

function resolve(reference, from = apiUrl) {
  const url = new URL(reference, from);
  const fragment = decodeURIComponent(url.hash.slice(1));
  url.hash = '';
  const document = documents.get(url.href);
  assert(document, `Missing published schema document: ${url.href}`);
  const value = fragment.split('/').slice(1).reduce((item, key) => item?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], document);
  assert.notEqual(value, undefined, `Unresolved schema reference: ${reference}`);
  return value;
}
function visit(value, fn) {
  if (!value || typeof value !== 'object') return;
  fn(value);
  for (const child of Object.values(value)) visit(child, fn);
}
function parameters(path) {
  return api.paths[path].get.parameters.map(p => p.$ref ? resolve(p.$ref) : p);
}
function query(path, name) {
  const parameter = parameters(path).find(p => p.in === 'query' && p.name === name);
  assert(parameter, `${path} is missing query parameter ${name}`);
  return parameter;
}

test('OpenAPI covers every current API.md route, with stable operation ids and public GET access', () => {
  assert.equal(api.openapi, '3.1.0');
  assert.equal(api.servers[0].url, 'https://wasm.fyi');
  assert.deepEqual(api.security, []);
  const docs = readFileSync(new URL('../API.md', import.meta.url), 'utf8');
  const documented = [...docs.matchAll(/^\| (GET|POST) \| `([^`]+)` \|/gm)].map(([, method, route]) => `${method.toLowerCase()} ${route}`).sort();
  const operations = Object.entries(api.paths).flatMap(([route, methods]) => Object.entries(methods).map(([method, op]) => ({ key: `${method} ${route}`, op })));
  assert.equal(documented.length, 14);
  assert.deepEqual(operations.map(x => x.key).sort(), documented);
  assert.equal(new Set(operations.map(x => x.op.operationId)).size, operations.length);
  assert(operations.every(x => x.op.operationId));
  assert.deepEqual(api.paths['/api/captures'].post.security, [{ publisherToken: [] }]);
  assert(!Object.keys(api.paths).some(path => /^\/(api|admin)\/v1\//.test(path)));
});

test('all local and cross-document references resolve in the published three-file contract', () => {
  let count = 0;
  for (const [url, document] of documents) {
    visit(document, value => {
      if (value.$ref) {
        resolve(value.$ref, url);
        count++;
      }
    });
  }
  assert(count > 100);
});

test('all GET operations document ETag revalidation and accurate error content types', () => {
  for (const [path, methods] of Object.entries(api.paths)) {
    if (!methods.get) continue;
    const op = methods.get;
    assert(parameters(path).some(p => p.in === 'header' && p.name === 'If-None-Match'));
    assert(op.responses['200'].headers.ETag);
    const notModified = resolve(op.responses['304'].$ref);
    assert(notModified.headers.ETag);
    assert.equal(notModified.content, undefined, '304 must not promise a body');
    const tooLarge = resolve(op.responses['422'].$ref);
    assert(tooLarge.content['text/plain']);
    assert.equal(tooLarge.content['application/json'], undefined);
    assert(resolve(op.responses['429'].$ref).headers['Retry-After']);
    for (const status of ['400', '405', '500', '503']) assert(op.responses[status]);
  }
});

test('compact pages have the actual 15-field schema-2 tuple and nullable dictionaries', () => {
  assert.equal(compact.MatrixPage.properties.schema.const, 2);
  const expected = ['observationId', 'contractIndex', 'configurationIndex', 'sourceIndex', 'capturedAtIndex',
    'latencyNs', 'peakRssBytes', 'codeBytes', 'latencyStatus', 'memoryStatus', 'codeStatus', 'codeKind',
    'timingSamples', 'samplingIndex', 'retainedSampleStats'];
  assert.deepEqual(compact.MatrixRow.prefixItems.map(p => p.title), expected);
  assert.equal(compact.MatrixRow.minItems, 15);
  assert.equal(compact.MatrixRow.maxItems, 15);
  assert.equal(compact.MatrixRow.items, false);
  assert.deepEqual(compact.RetainedSampleStats.prefixItems.map(p => p.title), ['count', 'meanNs', 'sampleStdDevNs', 'minNs', 'maxNs']);
  assert(compact.RetainedSampleStats.prefixItems[2].type.includes('null'));
  for (const field of ['sources', 'sampling']) {
    assert(compact.MatrixPage.properties[field].items.anyOf.some(s => s.type === 'null'));
  }
  assert(!JSON.stringify(compact.MatrixPage).includes('samplesNs'));
  assert.deepEqual(compact.MetricStatus.enum, benchmark.Result.properties.latencyStatus.enum);
  const source = readFileSync(new URL('../service/internal/api/sql_matrix.go', import.meta.url), 'utf8');
  const row = source.match(/out\.Rows = append\(out\.Rows, \[\]any\{([^\n]+)\}\)/)?.[1];
  assert(row);
  assert.equal(row.split(',').length, compact.MatrixRow.prefixItems.length, 'Wire tuple changed without updating its schema');
});

test('record and compact pagination retain distinct limits, continuations, and 409 recovery', () => {
  for (const path of ['/api/matrix', '/api/timeline']) {
    assert.deepEqual(query(path, 'limit').schema, { type: 'integer', minimum: 1, maximum: 4096, default: 4096 });
    assert.equal(query(path, 'offset').schema.maximum, 5000000);
    assert.match(query(path, 'offset').description, /revision/);
    assert(query(path, 'revision'));
    assert(api.paths[path].get.responses['409']);
    assert.equal(query(path, 'platform').required, true);
  }
  for (const path of ['/api/benchmarks', '/api/history']) {
    assert.deepEqual(query(path, 'limit').schema, { type: 'integer', minimum: 1, maximum: 1000, default: 200 });
    assert.equal(query(path, 'cursor').schema.maxLength, 4096);
    assert.notEqual(query(path, 'platform').required, true, 'A cursor supplies the platform on later pages');
    assert(api.paths[path].get.responses['409']);
    assert.equal(api.paths[path].get.responses['200'].content['application/json'].schema.$ref, 'benchmark.schema.json#/$defs/BenchmarkPage');
  }
});

test('aggregate and history query schemas preserve metric vocabularies and scope rules', () => {
  assert.deepEqual(compact.AggregateMetric.enum, ['compile', 'inst', 'instantiate', 'first', 'first-call', 'steady', 'rssCompile', 'rssInst', 'rssFirst', 'rss', 'rssAverage', 'code']);
  assert.deepEqual(compact.HistoryMetric.enum, ['exec', 'compile', 'inst', 'mem', 'code', 'cov', 'callTotal', 'hostWasm', 'wasmHostLoop']);
  assert.equal(query('/api/aggregates', 'metrics').schema.maxItems, 12);
  assert.equal(query('/api/aggregates', 'metrics').explode, false);
  assert.equal(query('/api/aggregates', 'metric').schema.default, 'steady');
  for (const path of ['/api/aggregates', '/api/history/summary', '/api/history/comparison', '/api/history/report']) {
    assert.equal(query(path, 'engines').schema.maxItems, 128);
    assert.equal(query(path, 'engines').explode, false);
    assert.equal(query(path, 'weighting').schema.default, 'corpus');
    assert.equal(query(path, 'cohort').schema.default, 'shared');
    assert.equal(query(path, 'average').schema.default, 'geo');
    if (path.includes('/history/')) {
      assert.equal(query(path, 'metric').schema.default, 'exec');
      assert(!parameters(path).some(p => p.name === 'revision'), 'History summary revision is a response consistency key, not an accepted query parameter');
    }
  }
  for (const path of ['/api/history/comparison', '/api/history/report']) {
    for (const name of ['fromDate', 'toDate']) assert.equal(query(path, name).required, true);
  }
  assert.equal(query('/api/history/report', 'engine').required, true);
});

test('response contracts allow actual empty and optional fields without closing future response extensions', () => {
  for (const name of ['workloads', 'participants', 'cards']) assert(compact.Aggregate.properties[name].type.includes('null'));
  assert(compact.HistoricalSummary.properties.workloads.type.includes('null'));
  for (const field of ['source', 'latestCreated', 'fingerprint', 'previous', 'first', 'calls']) {
    assert(!compact.HistoricalLane.required.includes(field));
  }
  assert.equal(compact.HistoricalReport.properties.fromDate.format, undefined, 'Empty report dates must remain valid');
  assert.equal(compact.HistoricalReport.properties.toDate.format, undefined);
  for (const schema of Object.values(compact)) {
    if (schema.type === 'object') assert.notEqual(schema.additionalProperties, false);
  }
});

test('Sampling covers fixed feature probes and adaptive performance without mixing their policies', () => {
  const sampling = benchmark.Sampling;
  assert.deepEqual(sampling.properties.method.enum, ['same-process-stability-v1', 'feature-compatibility-v1']);
  assert.deepEqual(sampling.properties.maxSamples.enum, [1, 10, 25, 35]);
  const policies = new Map(sampling.allOf.map(branch => [branch.if.properties.method.const, branch.then.properties]));
  assert.deepEqual(policies.get('feature-compatibility-v1'), {
    groupSize: { const: 1 }, maxSamples: { const: 1 }, retainedStart: { const: 0 }, stopReason: { const: 'fixed-sample' }
  });
  assert.deepEqual(policies.get('same-process-stability-v1'), {
    groupSize: { const: 5 }, maxSamples: { enum: [10, 25, 35] }, stopReason: { enum: ['stable', 'sample-cap'] }
  });
  execFileSync(process.execPath, ['scripts/generate-benchmark-types.mjs', '--check'], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
});
