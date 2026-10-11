# Machine-readable access

Start at [the API and measurement guide](https://wasm.fyi/docs/) or
[/llms.txt](https://wasm.fyi/llms.txt). Public reads do not need JavaScript,
authentication, an API key or a special user agent. The current service stores
indexed measurements and ordered timing samples in SQLite.

## Discovery and contracts

| URL | Purpose |
| --- | --- |
| `/docs/` | Prerendered, human-readable API and interpretation guide |
| `/llms.txt` | Short resource index and core interpretation rules |
| `/llms-full.txt` | Expanded API navigation, pagination, units and provenance |
| `/data/llm/index.json` | Versioned API discovery manifest; not a measurement snapshot |
| `/schemas/api-v1.openapi.json` | Current OpenAPI 3.1 contract (the filename is retained for compatibility) |
| `/schemas/benchmark.schema.json` | Record/capture schema, including status and sampling contracts |
| `/workloads/` and `/bench/<contractId>/` | Prepared application corpus catalog and semantic contract pages |
| `/data/llm/workloads.json` | Prepared corpus metadata, explicitly separate from measured results |
| `/reference.md` | Published copy of the repository's full `API.md` |
| `/api/platforms` | Live measured platform IDs and catalog revision |
| `/api/summary` | Live counts, machine specifications and freshness |
| `/sitemap.xml` | Canonical public information pages, including `/docs/` |
| `/robots.txt` | Crawl permission and sitemap/discovery links |

Prepared workload pages describe committed corpus artifacts, source identities and
operation contracts. They do not freeze API measurements or establish runtime support.
New live imports outside this build inventory still work as interactive detail pages.

The old static benchmark shards and `/api/v1/*` routes are retired. There is no
archived report lookup or compatibility alias. Do not infer that the discovery
manifest contains current measurements. Follow the live API links.

## Read-only workflow

1. Fetch `/api/platforms` and choose a returned `items[].id`.
2. Request `/api/benchmarks?platform=ID&phase=steady&limit=20`.
3. Follow opaque, URL-encoded `nextCursor` values until null. Record pages accept
   limits of 1–1000. Keep the same query scope and restart on HTTP 409.
4. Use `/api/history` for historical rows. `/api/matrix` and `/api/timeline` are
   compact scalar alternatives: follow `nextOffset` and `revision` until null,
   keeping scope fixed; their maximum page size is 4096.
5. Fetch `/api/observation?platform=ID&id=OBSERVATION_ID` only when you need full
   ordered samples. Forward `source.asOf` for an exact historical alias.
6. Prefer `/api/summary`, `/api/overview`, `/api/aggregates` and the history
   summary/comparison/report endpoints when aggregate information is enough.

The platform catalog revision is global; result revisions are scoped. Never
substitute one for another or join pages from changing revisions. Retain ETags
per exact URL and use `If-None-Match`; a 304 response has no JSON body. Respect
`Retry-After` on 429. Errors contain `{ "error": { "code", "message" } }` and are
not measurement records. Do not issue writes to explore the dataset.

See [API.md](../API.md) for full queries, responses and publication boundaries.

## Interpretation and citations

- `latencyNs` is median **nanoseconds per operation**. `peakRssBytes` and
  `codeBytes` are **bytes**. Display conversions are not API units.
- Only `ok` status has a numeric value. Other statuses have null values. Missing
  rows are not zero, and are not proof of unsupported behavior. Latency, memory
  and code statuses are independent.
- Compare matched platforms, artifact/contract hashes, phases, runtime
  configurations and sampling policies. Preserve the full query, revision,
  source revision, `capturedAt` and observation identity in citations.
- Current results select the latest qualified source snapshot per engine; missing
  cells stay missing. Historical `source.asOf` is a source target date, whereas
  `capturedAt` is when the measurement ran.
- Adaptive samples measure within-process repeatability, not independent-launch
  confidence intervals. Inspect the retained-window sampling policy and ordered
  samples. Saved legacy captures keep their original policy.
- RSS is a process high-water mark, not heap allocation or a phase delta. Respect
  `codeKind`: native images, engine-reported code and legacy unknown definitions
  must not be treated as equivalent.
- Feature probes establish exact corpus contracts, not full specification
  conformance or browser support. Unmatched/incomplete coverage does not imply
  a universal fastest runtime.
- Measurements, metadata and timing samples are retained; execution evidence,
  Wasm binaries and archived run reports are not. A capture receipt is not a
  downloadable report.

## HTML and crawler behavior

Public information pages serve the same prerendered semantic HTML to every user
agent. Interactive measurements load from the live API; initial chart states do
not establish data availability. Navigation uses ordinary links. Unique page
metadata, canonical URLs, truthful WebPage/WebSite identity and the sitemap help
discovery. Operational pages and unresolved application shells are noindex.
No crawler-specific cloaking, fabricated dataset dates, search-ranking promise,
new data license or indexing guarantee is introduced.

Canonical landing-page URLs omit interactive filters; they are not citations
for a particular platform or result. Preserve full API scope when citing data.

## Build and regression checks

`frontend-assets.mjs` generates documentation deterministically and copies the
current OpenAPI/JSON schemas and HTTP reference. No live data is fetched and no
wall-clock freshness timestamp is inserted. Builds clear only their generated
asset directory to prevent stale shards from surviving a previous build.
`BASE_PATH` applies to frontend/document URLs. API routes remain at the origin
root, as in the existing UI deployment contract.

```sh
pnpm check
pnpm test:discovery
pnpm build
node scripts/check-build.mjs
BASE_PATH=/wasm.fyi pnpm build
BASE_PATH=/wasm.fyi node scripts/check-build.mjs
```

The discovery checks cover base paths, deterministic content, schema resolution,
HTML titles/descriptions/canonicals, semantic guide content, noindex boundaries,
sitemap targets and absence of bundled measurement data. Go tests cover actual
frontend status/redirect/cache behavior and observation-detail resolution.
