import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SITE_ORIGIN, SITE_DESCRIPTION } from '../../src/lib/site.ts';
import { MET, PHASE_NOTE } from '../../src/lib/data/metrics.ts';

export const AI_PATH = 'data/llm';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const line = value => String(value ?? '').replace(/[\r\n|]/g, ' ').trim();
export function siteUrl(path, base = '') {
  assert(base === '' || /^\/(?!\/)[A-Za-z0-9_./-]+$/.test(base) && !base.endsWith('/') && !base.split('/').includes('..'), 'Invalid BASE_PATH');
  return SITE_ORIGIN + base + '/' + path.replace(/^\//, '');
}
const pagePath = id => 'bench/' + id.split('/').map(encodeURIComponent).join('/') + '/';
export const metricDefinitions = () => Object.fromEntries([
  ...Object.entries(MET).map(([id, m]) => [id, { label: m.l, unit: m.u, note: PHASE_NOTE[id] }]),
  ...Object.entries({ rssCompile: 'compile', rssInst: 'instantiate', rssFirst: 'first-call' }).map(([id, scenario]) => [id, {
    label: `${scenario} run process lifetime peak RSS`, unit: MET.rss.u,
    note: PHASE_NOTE.rss + ` Matched ${scenario} scenario.`
  }])
]);
export const POLICY = [
  'These exports use the same checksum-verified measured view as the website. They are not independent benchmark runs.',
  's1 selects the newest matching report per host, configuration and workload artifact; s2 selects the previous matching report. Neither is one simultaneous run. A newer failed or unsupported result is never replaced by an older success.',
  'Each result retains its report ID. Read that report for the exact runtime version, flags, host, collection time, warmup and sampling policy. Host configuration labels alone do not establish every cell’s version.',
  'Missing is never zero. Non-ok results have null values and preserve their reasons; an omitted workload/configuration/metric combination means not-measured, not unsupported. A measured zero remains zero.',
  'Timing values are milliseconds per reported operation/iteration; inspect each workload’s work unit, units per invocation, reset policy and oracle before comparing. RSS is process lifetime peak RSS in MiB, not a heap or phase delta. Code is an extracted native image in KiB, not active function code.',
  'Feature evidence covers representative exact-oracle corpus contracts under pinned adapter configurations, not complete specification conformance or browser release support. Compile-only evidence does not establish execution support; unloaded plugins cannot be judged by core-adapter results.',
  'History is retrospective Wago revisions measured with a fixed corpus and fixed comparison-engine baselines. Target week and actual collection date differ; this is not an archive of measurements collected each week.',
  'Compare matched artifacts, hosts, configurations and measurement policies. No global fastest-runtime ranking is inferred from incomplete coverage.'
];

function decodeRows(view, hostId, snapshot, definitions) {
  const slots = Object.keys(view.configurations);
  const seen = new Set();
  return view.hosts[hostId].snapshots[snapshot].map(([w, c, m, s, r, value, interval, launches, reason]) => {
    const workload = view.catalogue[w]?.id, configuration = slots[c], metric = view.metrics[m], status = view.statuses[s], report = view.reportIds[r];
    assert(workload && configuration && definitions[metric] && status && view.reports[report], 'Invalid packed cell reference');
    const key = JSON.stringify([workload, configuration, metric]);
    assert(!seen.has(key), 'Duplicate packed cell'); seen.add(key);
    assert(status !== 'ok' || typeof value === 'number' && Number.isFinite(value) && value >= 0, 'An ok result requires a finite non-negative measurement');
    assert(status === 'ok' || value == null, 'A non-ok result cannot carry a measurement');
    assert(reason == null || typeof view.reasons[reason] === 'string', 'Invalid reason reference');
    assert(interval == null || status === 'ok' && interval.length === 2 && interval.every(Number.isFinite), 'Invalid interval');
    return { workload, configuration, runtime: view.configurations[configuration], metric,
      status: status === 'nm' ? 'not-measured' : status,
      value: value ?? null, unit: definitions[metric].unit, interval: interval ?? null,
      launchMedians: launches ?? null, reason: reason == null ? null : view.reasons[reason], report };
  });
}

/** Pure, deterministic rendering. No wall-clock timestamp or network requests. */
export function renderAiMetadata(view, features, { base = '', sourceSha256, featuresSha256 } = {}) {
  assert(view.statuses.every(s => ['ok', 'unsupported', 'failed', 'nm'].includes(s)), 'Unknown result status');
  assert(view.schema === 1 && view.encoding === 'indexed-cells-v1', 'Unsupported measured view encoding');
  assert(features.schema === 1 && Array.isArray(features.hosts), 'Unsupported feature evidence schema');
  const url = path => siteUrl(path, base);
  const metrics = metricDefinitions();
  assert(view.metrics.every(id => metrics[id]), 'Unrecognized metric');
  const artifacts = new Map();
  const provenance = { measuredViewSha256: sourceSha256, featureEvidenceSha256: featuresSha256 };
  const writeJson = (name, value) => artifacts.set(`${AI_PATH}/${name}`, json(value));
  const reports = Object.fromEntries(Object.entries(view.reports).map(([id, report]) => [id, {
    ...report, evidenceUrl: url('wasmbench/' + report.evidence),
    summaryUrl: url('wasmbench/' + report.evidence.replace(/\.json$/, '.summary.json'))
  }]));
  writeJson('reports.json', { schema: 1, reports });
  // The catalogue's convenience ms field has an implicit baseline. Do not export
  // it as a workload fact: measurements belong to their explicit report/host cell.
  const workloads = view.catalogue.map(({ ms, kb, ...w }) => ({ ...w, artifactBytes: kb * 1024, url: url(pagePath(w.id)) }));
  writeJson('workloads.json', { schema: 1, workloads });
  const datasets = [];
  const counts = [];
  for (const [hostId, host] of Object.entries(view.hosts)) {
    assert(/^[a-z0-9-]+$/.test(hostId), 'Unsafe host ID');
    for (const snapshot of Object.keys(host.snapshots)) {
      assert(/^s[12]$/.test(snapshot), 'Unknown snapshot');
      const rows = decodeRows(view, hostId, snapshot, metrics);
      // Keep fetches bounded: one host/snapshot/metric, not a multi-megabyte
      // all-metrics payload that an LLM tool may truncate before it can inspect it.
      for (const metric of view.metrics) {
        const results = rows.filter(row => row.metric === metric);
        const file = `benchmarks-${hostId}-${snapshot}-${metric}.json`;
        writeJson(file, { schema: 1, host: hostId, snapshot, metric, missingCellStatus: 'not-measured', results });
        const bytes = artifacts.get(`${AI_PATH}/${file}`);
        datasets.push({ host: hostId, snapshot, metric, url: url(`${AI_PATH}/${file}`), results: results.length,
          bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) });
      }
      if (snapshot === 's1') for (const slot of Object.keys(view.configurations)) {
        const selected = rows.filter(r => r.configuration === slot);
        const statuses = Object.fromEntries(['ok', 'unsupported', 'failed', 'not-measured'].map(status => [status, selected.filter(r => r.status === status).length]));
        counts.push({ host: hostId, configuration: slot, ...statuses,
          absent: view.catalogue.length * view.metrics.length - selected.length });
      }
    }
  }
  const featureSummary = features.hosts.map(h => ({ host: h.host, configurations: h.configurations.map(c => ({
    id: c.id, identity: c.identity, description: c.description, features: c.features.map(({ cases, ...f }) => ({ ...f, cases: cases.length }))
  })) }));
  writeJson('features.json', { schema: 1, policy: features.policy, expectedFeatures: features.expectedFeatures,
    evidenceUrl: url('wasmbench/feature-support.json'), hosts: featureSummary });
  const latest = Object.values(reports).map(r => r.created).sort().at(-1) ?? null;
  const manifest = {
    schema: 1, title: 'wasm.fyi', description: SITE_DESCRIPTION, url: url(''),
    provenance, latestEvidenceCollectedAt: latest, policy: POLICY, metrics,
    configurations: view.configurations,
    hosts: Object.fromEntries(Object.entries(view.hosts).map(([id, { snapshots, ...host }]) => [id, host])),
    workloads: url(`${AI_PATH}/workloads.json`), reports: url(`${AI_PATH}/reports.json`), datasets,
    features: url(`${AI_PATH}/features.json`), featureEvidence: url('wasmbench/feature-support.json'),
    currentEvidence: url('wasmbench/index.json'),
    history: Object.keys(view.history).map(id => ({ host: id,
      index: url(`wasmbench/${id === 'm1' ? 'history-hub' : 'history'}/index.json`),
      weeks: url(`wasmbench/${id === 'm1' ? 'history-hub' : 'history'}/weekly.json`) })),
    threads: Object.entries(view.threads).map(([host, t]) => ({ host, collectedAt: t.created, sha256: t.sha256, evidence: url('wasmbench/threads/' + t.evidence) })),
    sourceRepository: 'https://github.com/JairusSW/wasm.fyi',
    schemaUrl: url(`${AI_PATH}/schema.json`)
  };
  writeJson('index.json', manifest);
  writeJson('schema.json', {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: url(`${AI_PATH}/schema.json`),
    title: 'wasm.fyi benchmark result shard v1', type: 'object',
    required: ['schema', 'host', 'snapshot', 'metric', 'missingCellStatus', 'results'],
    properties: { schema: { const: 1 }, metric: { enum: Object.keys(metrics) }, host: { type: 'string' }, snapshot: { enum: ['s1', 's2'] },
      missingCellStatus: { const: 'not-measured' }, results: { type: 'array', items: {
        type: 'object', required: ['workload', 'configuration', 'runtime', 'metric', 'status', 'value', 'unit', 'interval', 'launchMedians', 'reason', 'report'],
        properties: { workload: { type: 'string' }, configuration: { type: 'string' }, runtime: { type: 'string' },
          metric: { enum: Object.keys(metrics) }, status: { enum: ['ok', 'unsupported', 'failed', 'not-measured'] },
          value: { type: ['number', 'null'], minimum: 0 }, unit: { enum: ['ms', 'MiB', 'KiB'] },
          interval: { type: ['array', 'null'], items: { type: 'number' }, minItems: 2, maxItems: 2 },
          launchMedians: { type: ['array', 'null'], items: { type: 'number' } },
          reason: { type: ['string', 'null'] }, report: { type: 'string' } },
        allOf: [{ if: { properties: { status: { const: 'ok' } } }, then: { properties: { value: { type: 'number' } } },
          else: { properties: { value: { type: 'null' }, interval: { type: 'null' } } } }]
      } } }
  });
  const pages = [['', 'Overview'], ['benchmarks/', 'Benchmarks'], ['features/', 'Feature evidence'], ['history/', 'Retrospective history'], ['compare/', 'Runtime registry'],
    ...['simd', 'gc', 'memory64', 'threads'].map(id => [`${id}/`, id])];
  const concise = ['# wasm.fyi', '', `> ${SITE_DESCRIPTION}`, '',
    'Generated from the current build’s verified data. No JavaScript, login, or browser interaction is required for the following resources.', '',
    '## Machine-readable data', '',
    `- [Data manifest](${url(`${AI_PATH}/index.json`)}): start here for hosts, metrics, units, provenance, benchmark shards, features, history and worker evidence.`,
    `- [Workload catalogue](${url(`${AI_PATH}/workloads.json`)}): exact artifact identities, work units, reset policy, oracles and page links.`,
    `- [Report directory](${url(`${AI_PATH}/reports.json`)}): per-result report IDs resolve to sealed raw evidence and report summaries with exact configurations.`,
    `- [Feature evidence](${url('wasmbench/feature-support.json')}): pinned configurations, exact contract outcomes and reasons.`,
    `- [Expanded reference](${url('llms-full.txt')}): methodology, hosts, configuration coverage and the complete workload catalogue.`, '',
    '## Reading results correctly', '', ...POLICY.map(p => `- ${p}`), '', '## Website', '', ...pages.map(([path, label]) => `- [${label}](${url(path)})`), '',
    '## Source', '', '- [Source and methodology](https://github.com/JairusSW/wasm.fyi)', ''];
  artifacts.set('llms.txt', concise.join('\n'));
  const full = [...concise, '## Dataset inventory', '',
    `Latest evidence collection time across linked reports: ${latest ?? 'not collected'}. This is not the deployment time.`,
    `Workloads: ${workloads.length}. Hosts: ${Object.keys(view.hosts).length}. Configuration slots: ${Object.keys(view.configurations).length}.`, '',
    ...datasets.map(d => `- ${d.host}/${d.snapshot}/${d.metric}: ${d.results} recorded cells; ${d.url}`), '', '## Metrics', '',
    ...Object.entries(metrics).map(([id, m]) => `- ${id}: ${m.label} (${m.unit}). ${m.note}`), '', '## Hosts and configuration labels', ''];
  for (const [id, host] of Object.entries(view.hosts)) {
    full.push(`### ${id}: ${line(host.label)}`, '', `OS: ${line(host.os)}`, `Policy: ${JSON.stringify(host.policy)}`, '',
      ...Object.entries(host.configurations).map(([slot, c]) => `- ${slot}: ${line(c.runtime)}; backend ${line(c.backend)}; version ${line(c.version)}`), '');
  }
  full.push('## Current snapshot result coverage', '', 'Counts are metric cells, not passed workloads or specification tests. Absent cells are not measured. Coverage is not a performance ranking.', '',
    '| Host | Configuration | Ok | Unsupported | Failed | Not measured | Absent |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...counts.map(c => `| ${c.host} | ${c.configuration} (${view.configurations[c.configuration]}) | ${c.ok} | ${c.unsupported} | ${c.failed} | ${c['not-measured']} | ${c.absent} |`), '',
    '## Feature coverage', '', features.policy, '', `Detailed contract cases and evidence: ${url('wasmbench/feature-support.json')}`, '');
  for (const h of featureSummary) for (const c of h.configurations) {
    full.push(`### ${line(h.host.hostname)} ${line(h.host.os)}/${line(h.host.arch)}: ${line(c.id)}`, '',
      `Pinned identity: ${c.identity}`, '', '| Feature | Coverage | Executed | Compile only | Unsupported | Failed |', '| --- | --- | ---: | ---: | ---: | ---: |',
      ...c.features.map(f => `| ${line(f.id)} | ${f.coverage} | ${f.executed} | ${f.compiledOnly} | ${f.unsupported} | ${f.failed} |`), '');
  }
  full.push('## Workload catalogue', '', 'All measured values are in the linked shards; no implicit baseline timing is attached to a workload.', '');
  for (const w of workloads) full.push(`### ${line(w.id)}`, '', `${w.url}`, '',
    `- Purpose: ${line(w.purpose)}`, `- Group: ${line(w.group)}; ABI: ${line(w.abi)}; evidence scope: ${line(w.evidenceScope) || 'not specified'}; scalar baseline: ${w.baseline === true}`,
    `- Artifact SHA-256: ${w.artifactSha256}; bytes: ${w.artifactBytes}`,
    `- Work unit: ${line(w.workUnit)}; units per invocation: ${w.unitsPerInvocation}; reset: ${line(w.reset)}`,
    `- Input: ${line(w.input)}; oracle: ${JSON.stringify(w.oracle)}`, '');
  full.push('## Report provenance', '', ...Object.entries(reports).map(([id, r]) => `- ${id}: collected ${r.created}; run ${line(r.runId)}; host ${r.host}; configurations ${r.configurations.join(', ')}; SHA-256 ${r.sha256}; ${r.evidenceUrl}`), '');
  artifacts.set('llms-full.txt', full.join('\n'));
  const sitemap = [...pages.map(([path]) => url(path)), ...workloads.map(w => w.url), url('llms.txt'), url('llms-full.txt')];
  artifacts.set('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [...new Set(sitemap)].map(loc => `  <url><loc>${xml(loc)}</loc></url>`).join('\n') + '\n</urlset>\n');
  artifacts.set('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${url('sitemap.xml')}\n\n# LLM reference: ${url('llms.txt')}\n# Structured data: ${url(`${AI_PATH}/index.json`)}\n`);
  return artifacts;
}
