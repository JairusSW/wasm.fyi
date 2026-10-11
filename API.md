# wasm.fyi API

The API stores current and source-pinned historical WebAssembly benchmark measurements. Capture and record contracts are defined
by [OpenAPI](schemas/api-v1.openapi.json), [JSON Schema](schemas/benchmark.schema.json)
and [generated TypeScript types](src/lib/api/benchmark-types.ts). Compact browsing
contracts are documented below, with client shapes in
[compact-matrix.ts](src/lib/api/compact-matrix.ts) and
[compact-history.ts](src/lib/api/compact-history.ts).

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/summary` | Small materialized counts, machine specs and freshness |
| GET | `/api/platforms` | Discover measured platforms |
| GET | `/api/matrix` | Compact scalar table with shared metadata dictionaries |
| GET | `/api/timeline` | Paginated historical scalar rows for explicit queries |
| GET | `/api/history/summary` | Weekly graph points without measurement rows |
| GET | `/api/history/comparison` | Exact matched-cohort change across a date range |
| GET | `/api/history/report` | Matched workload values for one runtime and date range |
| GET | `/api/overview` | Engine/phase scalar averages |
| GET | `/api/aggregates` | Scoped server-side comparison averages and ratios |
| GET | `/api/observation` | Full ordered samples for one observation |
| GET | `/api/benchmarks` | Page results for one platform and phase |
| GET | `/api/history` | Page source-pinned history for one platform and phase |
| POST | `/api/captures` | Publish a complete capture atomically |
| GET | `/healthz` | Database readiness |

The service uses native SQLite with WAL and atomic batched writes. Old `/api/v1/*`, `/admin/v1/*`
and evidence/report endpoints have no compatibility aliases and return HTTP 404.

## Compact browsing

`GET /api/summary` returns `revision` and `platforms`: specs, latest/history row
counts, alias-deduplicated timing counts, original capture time and actual import
time. It does not read sample vectors. All GET responses support ETag/304.

The matrix and timeline accept `corpus=main` (application workloads and call mechanisms)
or `corpus=features`; omit it for all workloads. Pagination revisions include this filter.
The benchmarks and features pages request only their own corpus.

`GET /api/matrix?platform=ID&phase=steady&limit=1000` returns schema 2 with
`contracts`, `configurations`, `sources`, `sampling`, `capturedAt`, and `rows`
dictionaries. Each scalar row has these 15 positions:

```
[observationId, contractIndex, configurationIndex, sourceIndex, capturedAtIndex,
 latencyNs, peakRssBytes, codeBytes, latencyStatus, memoryStatus, codeStatus,
 codeKind, timingSamples, samplingIndex, retainedSampleStats]
```

`retainedSampleStats` is null or `[count, meanNs, sampleStdDevNs, minNs, maxNs]`,
computed once from the retained sample window. Raw observations remain available
in full on the detail endpoint.

The envelope also has `revision`, `platform`, `phase`, `total`, and `nextOffset`.
Continue with `offset=nextOffset&revision=REVISION` and the same filters. A null
next offset ends pagination. Optional exact filters: `workload`, `engine`.
Limit is 1–4096. Revisions bind the full scope; any scope or platform-data change
returns 409. `/api/timeline` has the same shape and additionally accepts inclusive
`from`/`to` source dates. History defaults newest first. Browsing never includes
raw samples.

`GET /api/observation?platform=ID&id=OBSERVATION_ID` returns the complete result,
including every sample in acquisition order. Optional `asOf` selects the exact
weekly alias source. Observation IDs are database-local detail keys, not commit
hashes. `/api/overview?platform=ID` returns small engine/phase counts and scalar
arithmetic means. `/api/aggregates?platform=ID&metric=steady` returns `revision`, `platform`,
`metric`, unique main `workloads`, `participants`, and scalar engine `cards`.
Optional parameters: comma-separated `engines`, `baseline`, `weighting` (`corpus`
or `workload`), `cohort` (`shared` or `per-engine`), and `average` (`geo` or `mean`).
Cards include engine/version/backend/source, value, ratio, count and latest capture
creation time. Defaults: steady, corpus weighting, shared cohort, geometric mean.
RSS across phases uses the existing arithmetic-mean policy. Features and host-call
mechanisms do not enter main workload averages. A scalar snapshot and bounded
scope cache avoid reading samples or recomputing identical comparison scopes.

## Historical graphs

`GET /api/history/summary?platform=ID&metric=exec` returns dates and compact
runtime lanes: value, measured/reference counts, version/backend/source, and
matched first/previous comparisons. It sends no observation rows or samples.
Metrics: `exec`, `compile`, `inst`, `mem`, `code`, `cov`, `callTotal`, `hostWasm`,
`wasmHostLoop`. Optional scope: `engines`, `baseline`, `weighting`, `cohort`,
`average`, `workload`, `from`, `to`. Date windows use inclusive UTC source dates.
The current workload cohort is held fixed across the historical graph.
`callTotal` sums both directions and includes their individual values.

`GET /api/history/comparison` takes the same scope plus `fromDate` and `toDate`.
Each runtime snaps inward to its first/last measured dates, then compares exactly
matched contracts using the same reference cohort and weighting. It returns
before/after values, ratio, count and whether the observations were reused.

`GET /api/history/report` adds `engine` to that comparison query and returns only
matched workload/group/before/after/ratio/reused fields. The frontend loads it
when opening a full runtime report. Changing a graph range does not download
all measurements. Graphs, comparisons and reports share a scope revision; results
from different revisions are not mixed. Server and browser caches are bounded.

## Record pagination

```sh
curl http://localhost:8788/api/platforms
curl 'http://localhost:8788/api/benchmarks?platform=PLATFORM_ID&phase=steady'
```

Platforms return `{ "revision": "…", "items": […] }`. This catalog revision is
global; result-page revisions are specific to the selected platform. Each item includes its ID,
OS, architecture, CPU, logical core count, kernel and optional RAM bytes. An empty
database returns `items: []`.

Results require `platform` on the first page. `phase` defaults to `steady`; allowed
values are `compile`, `instantiate`, `first-call` and `steady`. `limit` defaults to
200 and accepts 1–1000. The response contains `revision`, `platform`, `phase`,
`items`, `total` and `nextCursor`. A null `nextCursor` means the last page.

Pass `cursor=NEXT_CURSOR` to continue; platform and phase are carried by the
cursor. If supplied again, they must match. Page size may change. Treat cursors as
opaque strings and URL-encode them. They are signed, remain usable after server
restarts, and bind the query scope to one platform revision. Updates on another platform do
not invalidate pagination. A change to this platform, including another phase,
does invalidate it. HTTP 409 with
`revision_changed` means restart from the first page. Pagination snapshots are not retained. Historical measurements remain available through `/api/history`. Pages seek directly after the last row instead of scanning skipped rows.

Each result includes the workload, Wasm filename, artifact/contract hashes, engine,
version/backend, phase and `capturedAt`. The first table uses one latest source snapshot per engine for every metric. Qualified source builds take precedence over installed builds with unknown source age; source dates then determine recency. Missing results stay missing. Older snapshots appear in History. Measurements have explicit units and independent statuses:

| Value | Status | Meaning |
|---|---|---|
| `latencyNs` | `latencyStatus` | Median nanoseconds per operation |
| `peakRssBytes` | `memoryStatus` | Kernel-accounted peak RSS; compile uses max(translator, compiler) for transpilers |
| `codeBytes` | `codeStatus` | Complete native image or engine-reported native code size |

Statuses are `ok`, `failed`, `unsupported`, `disabled` or `not-measured`. Only `ok`
has a value; other values are null. A resource failure does not invalidate a valid
latency. Current captures use one persistent process, zero warmups, and ordered
sample groups of five, up to 10 samples for compilation and instantiation, or
25 for first-call and steady execution. Saved legacy captures may declare a
35-sample cap. Collection stops when the latest five
(or latest ten once available) have relative sample standard deviation at most
5% and drift between their half-window medians at most 3% of the mean. This is a
repeatability rule; it does not provide an independent-launch confidence interval.
An initial slow prefix may be excluded from the displayed median only after at
least 15 observations and two stable retained groups: prefix observations must
exceed the stable-window mean by max(two standard deviations, 3% of the mean).
Later outliers remain included. All raw verified observations remain in the observation-detail response
`samplesNs` in acquisition order; optional `sampling.retainedStart` records the
start of the displayed subset and `sampling.stopReason` is `stable` or `sample-cap`.
`sample-cap` requires exactly the declared `sampling.maxSamples` observations;
`stable` requires a multiple of five between five and that cap. New caps are
phase-specific: 10 only for `compile`/`instantiate`, 25 only for `first-call`/`steady`.
Feature compatibility probes use `sampling.method: "feature-compatibility-v1"`:
exactly one retained sample, group size and cap of one, zero warmups, no trimmed
prefix, and `stopReason: "fixed-sample"`. This policy is accepted only for
`features/` workloads; feature performance uses the adaptive policy above.
Older captures retain their original sampling policy. The callback loop is
normalized per boundary call. RSS uses the phase's kernel high-water mark when
available, with one RSS-only process pass per phase as the portable fallback;
those fallback timings are discarded. Transpiler compilation uses the maximum kernel-accounted translator/compiler child peak, including waited-for descendants, rather than the adapter peak or a sum. The maximum across measured trials is retained. Older transpiler captures may contain adapter-process RSS and need recollection for this definition; saved historical values are not rewritten. Compilation latency includes translation and native compilation/linking. Code size reuses the compiled transpiler artifact outside latency timers when available; otherwise it uses one cold compile pass; full images include embedded data. `codeKind` distinguishes `native-image` from `engine-reported`; unavailable code
has a null kind and displays `n/a`. Linked transpiler code sizes include executable bridge/runtime sections; they are not guest-only instruction counts. JavaScript native code is `n/a` when the embedding cannot expose attributable code. Old records without a definition return `unknown`, never an
inferred native image. New successful code captures must supply a known kind.
Do not treat sizes with different definitions as equivalent. Successful timing observations retain (and return on detail requests)
`samplesNs`: verified nanoseconds per operation, excluding warmups, with one value
per requested sample. The UI uses these values for sample plots and sample standard
deviation. Execution evidence and machine-code images are not retained.

`GET /api/history` uses the same parameters and response shape as `/api/benchmarks`.
Its cursors are scoped to history and cannot be used for current results. Historical
rows include `source`: `repository`, exact `revision`, `ref`, `asOf` (RFC3339),
and `kind` (`current`, `main`, `release`, or `snapshot`). `capturedAt` is always the
actual measurement date; `asOf` identifies the source target date.
Module-only Go versions also supply `dateBasis: "go-module-commit"`: their source
date is the registry's commit timestamp, and version links point to that commit.
Tag-only versions supply `dateBasis: "git-tag-commit"` and use the exact tagged
commit's timestamp and link. These dates are source dates, not release publication
dates.

Optional `display` metadata preserves workload group, purpose, tags, ABI, artifact
bytes, source link and reset policy. `timingSamples` counts verified measured samples,
excluding warmups. Neither field contains execution evidence.

## Publish

`POST /api/captures` requires `Content-Type: application/json` and
`Authorization: Bearer <WASMFYI_ADMIN_TOKEN>`. The body contains `capturedAt`
(RFC3339), `platform` specs, and `results`. Optional capture-level `source` applies to every result that does not supply its own source. There is no `schema` marker or separate
admin API. A capture is bounded to 1 MiB and 4096 results.

The service validates all rows, then commits the complete capture with one durable
WAL write. HTTP 200 returns `{ "id": "…" }`, a stable scope receipt, after durability.
This ID does not identify an archived capture or support a capture lookup endpoint.
Newer cells replace the same platform/workload/logical-engine/phase cells; unrelated
cells remain intact. Older or equal-time retries are ignored, making replay safe. An equal-time capture may add a previously missing native code size only when every non-code field matches exactly, including source, latency, ordered samples, sampling policy and RSS. Existing successful code sizes cannot be replaced this way; the original measurement timestamp is retained.
A rejected request changes nothing. Unreferenced metadata is reclaimed atomically.

`just bench` uses the local API and private token automatically. Use `--api-url`
plus `WASMFYI_ADMIN_TOKEN` for another server, or `--no-live` for offline capture.
Full diagnostic captures require `--full --no-live` and do not publish to this API.

## Errors and operation

Errors use `{ "error": { "code": "…", "message": "…" } }`. Common HTTP statuses:
400 invalid query/capture/cursor, 401 missing publisher token, 403 read-only mode,
404 unknown platform
or route, 405 wrong method, 409 changed revision, 413 oversized body, 415 wrong
content type, 429 admission limit and 503 request timeout. HTTP 429 includes
`Retry-After` for rate limits. Unknown/repeated query fields are rejected.

Run `just serve-local` or `just dev-caddy`. The private database is in
`.wasmfyi/local/data/benchmarks/`; `--data` selects another root. One process owns
it. Stop the server before an offline directory backup or
`wasmfyi ingest --data DIR --input capture.json`. `--read-only` disables publication.
Direct serving uses loopback; use an HTTPS proxy for public access. Static assets
have a separate admission pool and cannot exhaust database read budgets.

Source-pinned captures also retain historical cells by source date, workload and
engine configuration. Repeated captures update that historical cell. Collecting an
older source date preserves the newer source in the current view. Source dates and
capture dates are stored separately; collection never backdates measurements.

Native-code collectors use Wago's compiled code extent, Wazevo's isolated executable cache segment, Wasmtime's native text, WAVM's relocatable executable sections, Wasmer's optional SDK function-extent getter, V8's complete optimizing-function size diagnostics, SpiderMonkey's `wasmExtractCode`, and transpiler-linked executable sections. They never substitute serialized Wasm, bytecode, JavaScript source, full binary file size, or the engine's entire code heap for native code. Interpreters and embeddings without an attributable native-code getter report `unsupported` with null bytes (`n/a` in the UI).

Pages may contain fewer rows than `limit` to keep responses below the 1 MiB byte ceiling. Follow `nextCursor` until it is null. The call-latency table and history total add the two recorded per-call direction latencies; either missing direction leaves the total unmeasured.

The UI’s average peak RSS is the arithmetic mean of available compile, instantiate, first-call, and steady peak RSS measurements, with equal weight per measured workload-phase. Missing measurements are omitted. This is not time-averaged process RSS.

Imported measurements are self-contained in SQLite: ordered samples are binary
BLOBs, metadata is stored in shared database tables, and browsing statistics are
materialized in the database. JSON captures are ingestion transport only. The
API does not reopen capture files or sample dumps when serving data.

### Dashboard sign-in and analytics

`/dashboard` uses a separate GitHub browser session. The existing `/admin/v1/`
bearer-token publishing API and its token are unchanged. No GitHub OAuth app has
been provisioned automatically; outside guarded local development, missing client credentials make the page say
**Sign-in not configured**.

Create a production GitHub OAuth App in GitHub Settings → Developer settings
→ OAuth Apps. Local development skips sign-in by default; a separate local app
is optional if you want to test the real OAuth flow. Use these exact settings:

| App | Homepage | Authorization callback |
| --- | --- | --- |
| Production | `https://wasm.fyi` | `https://wasm.fyi/auth/github/callback` |
| Optional local OAuth | `http://localhost:8788` | `http://localhost:8788/auth/github/callback` |

Keep the application dedicated to public-profile sign-in. No scopes are
requested; a token carrying additional scopes is rejected rather than accepted
implicitly. The flow uses one-use state and PKCE S256, exchanges the code on the
server, fetches `/user`, and discards the GitHub access token. See
[GitHub's OAuth web-flow documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

The local startup helper explicitly sets `WASMFYI_DEV_ADMIN=1`. This opens the
local dashboard as `local-developer`, with **real analytics**, without a local
OAuth app or `local.env`. It does not grant publishing access. Startup rejects
this flag unless both the public origin and the literal API listener bind are
loopback; every bypassed request also requires the exact configured Host, a
loopback transport peer and a loopback client IP under the existing trusted-proxy
policy. Public forwarded clients cannot inherit development access. Production
never sets this flag and a `https://wasm.fyi` origin rejects it outright. Set
`WASMFYI_DEV_ADMIN=0` explicitly to test local GitHub sign-in instead. Sign-out is
hidden in development mode; disable the flag to restore authenticated sessions.

Local startup (`scripts/serve-local.sh`, `scripts/dev-caddy.sh`, and
`.wasmfyi/local/serve-local-built.sh`) loads the repository-root `local.env`
when present. Create it with mode 0600, owned by the current user, using plain
`KEY=value` lines for the credentials and optional origin, allowlist, session-secret
file, GeoIP directory or local port overrides. Quotes are allowed; no shell evaluation or expansion is
performed. Symlinks, world/group-readable files, duplicates and unknown keys are
rejected. Explicitly exported environment variables override file entries.

Use a private repository-root `prod.env` for production OAuth credentials; the
`just deploy` / `scripts/deploy-remote.sh` copies only dashboard settings into the existing private
service environment, preserving publishing credentials. Never put the client
secret in frontend source or commit either environment file:

- `WASMFYI_GITHUB_CLIENT_ID` and `WASMFYI_GITHUB_CLIENT_SECRET`: the matching app's credentials.
- `WASMFYI_DASHBOARD_ORIGIN`: defaults to `https://wasm.fyi`; local
  `.wasmfyi/local/serve-local-built.sh` explicitly defaults to `http://localhost:8788`.
  The service never constructs OAuth callbacks from an incoming Host or forwarded header.
  Local ports default to website `8788`, Go API `8789`, Vite `8790` so an
  existing 8080 server can remain running. Override them with
  `WASMFYI_LOCAL_PORT`, `WASMFYI_LOCAL_API_PORT`, and `WASMFYI_LOCAL_VITE_PORT`.
  Register the callback matching the selected website port.
- `WASMFYI_ADMIN_GITHUB_LOGINS`: comma-separated initial allowlist, default `JairusSW`.
  The first successful sign-in permanently pins that entry to GitHub's numeric
  user ID in `analytics.sqlite`. Renames retain access; reusing an old login does
  not. Removing an allowlist entry revokes its sessions. To replace an account,
  an operator must deliberately update that pin while the service is stopped.
- `WASMFYI_SESSION_SECRET`: at least 32 secret bytes, or
  `WASMFYI_SESSION_SECRET_FILE`: a private, regular, 32-byte file. If neither is
  set, a cryptographically random 0600 file named `session-secret` is generated
  beside `analytics.sqlite`. For production set the file to
  `/var/lib/wasmfyi/session-secret`. The local script uses
  `.wasmfyi/local/session-secret`, next to the local admin-token file.
  This secret is independent of the publishing token and cursor key. Rotate it
  to invalidate every dashboard session.
- `WASMFYI_GEOIP_DIR`: optional directory containing `GeoLite2-City.mmdb` and
  `GeoLite2-ASN.mmdb` (preferred), or compatible DB-IP Lite files named
  `dbip-city-lite.mmdb` and `dbip-asn-lite.mmdb` as fallbacks. Missing or invalid
  files cleanly disable that enrichment. Provision MaxMind files under its license,
  or update the free DB-IP Lite databases monthly and retain the dashboard
  [IP Geolocation by DB-IP](https://db-ip.com) attribution. No third-party client
  script runs. Installing a database enriches new traffic only; historical raw
  IPs are not stored and cannot be backfilled.

Sessions are HMAC-signed, HttpOnly, Secure, SameSite=Lax cookies scoped to `/`
and expiring after seven days. Logout revokes the cookie's nonce as well as
clearing it. Secure cookies remain enabled locally: browsers treating
`http://localhost` as trustworthy accept them; otherwise serve localhost with
TLS and register a matching HTTPS callback in the local app. Do not weaken the
cookie for public HTTP. GitHub sign-in requires the actual OAuth app and an
interactive allowed-account round trip; mocked provider tests do not prove that
external configuration is correct.

| Endpoint | Access / response |
| --- | --- |
| `GET /auth/github/login` | Redirect to GitHub; 503 when sign-in is unconfigured |
| `GET /auth/github/callback` | One-use state/PKCE exchange; only pinned/allowed account admitted |
| `GET /auth/me` | `{login, avatarUrl}`; 401 with `{configured:false}` when credentials are absent |
| `POST /auth/logout` | Same-origin request required; revoke and clear session; 204 |
| `POST /api/event` | Same-origin bounded SPA pageview beacon; honors DNT / Sec-GPC |
| `GET /api/admin/analytics?range=24h\|7d\|30d` | Session required; `Analytics`, including `places` |
| `GET /api/admin/bandwidth?window=1h\|1d\|1w\|1m` | Session required; `Bandwidth` |
| `GET /api/admin/totals` | Session required; `AllTime` |
| `GET /api/admin/live` | Session required; SSE each second: `{rate}` |

All authentication/analytics responses, including errors and SSE, are
`Cache-Control: no-store`. There are at most eight concurrent live streams; each
stream rechecks account authorization and expiry. No admin session grants
publishing privileges.

Analytics storage is **separate `analytics.sqlite`**, alongside the benchmark
DB, with WAL, a bounded nonblocking event queue, one batching writer and bounded
read/cache concurrency. Raw API log rows retain only route templates, UA family
and major version, timestamps/statuses/timing: **48 hours**. Minute rollups and
minute visitor sets retain **48 hours**. Fifteen-minute, hourly and daily
rollups/visitor sets retain **30 days**; maintenance prunes once per minute.
Counters (`since`, daily unique visitors, pageviews, requests by origin, bytes,
programmatic clients) survive pruning forever. Sparse varint histograms retain
latency distributions compactly; p50/p95 are conservative upper bounds from
logarithmic buckets, not exact individual request percentiles.

No raw IP, cookies, complete UA, URL query, or unrecognized path segments are
persisted. A random **memory-only** salt rotates at UTC midnight and after
restart. Visitor IDs are 128-bit keyed digests of IP + UA family (without the
major version); totals are sums of daily unique visitors, **not uniquely
identifiable people across days**. City coordinates are rounded to one decimal.
Unknown/overflow dimensions are grouped into `Other`; dictionaries,
DNS work, and response lists have explicit bounds. The last 60 seconds of byte
rates live only in memory. Online visitor counts, live page presence, and map
pings are not collected. Views count page loads/navigations; Unique views count
daily private visitor identities. Events may be
dropped under overload instead of slowing down API responses; service counters
track drops.

Client IP uses the same `X-Real-IP` policy as request admission: only configured
trusted transport peers can attest it. `X-Forwarded-For` is never trusted. Website
origin requires `Sec-Fetch-Site: same-origin|same-site` plus an exact configured
Origin/Referer host and scheme. Known crawler UAs are classified as bots even
when unverified; `(verified)` is shown only after reverse DNS matches the
provider's domain **and forward DNS confirms the same address**. Currently this
verification covers Googlebot, Bingbot and Applebot; other bots remain
unverified. Programmatic client keys use UA family + major version and numeric
ASN; without ASN data, unknown networks are intentionally grouped together.

Auth routes, dashboard analytics, readiness/health probes and the beacon itself
are excluded from visitor/API traffic; the beacon handler explicitly records
its validated pageview. Aggregate bandwidth includes normal pages/assets and
publishing body bytes without retaining publishing credentials. DNT/GPC requests
contribute only identity-free operational byte totals. Admin analytics excludes
itself, preventing SSE/polling from inflating the traffic it displays.

The strict 30-day retention limit cannot provide a previous complete 30-day
comparison. KPIs therefore include optional `comparisonAvailable:false` and
render a dash when the full previous period is absent; the same applies before
enough history has accumulated. `available:false` distinguishes uncollected
average visit duration and bounce rate. Page duration is also shown as
unavailable: no persistent visitor/session tracking or invented time estimates
are used. The frontend fetches the selected ranges on demand, refreshes once a
minute and maintains one SSE connection, without loading request dumps.

Shared cohort selection uses the passing set of the least-covered measured, selected
engine (ties resolve by engine identity). Engines missing measurements from that
reference set have no displayed current average. Native-code comparisons exclude
engines with no native code. Historical comparisons retain matched recorded pairs
within the current reference.

Correctness always counts the complete main workload catalogue; choosing a shared
averaging cohort never narrows the correctness denominator. If a successful
latency summary is zero or absent but the retained samples have a positive mean,
comparison calculations use that precomputed retained-sample mean. Cell details
label this recovery explicitly. The original summary and ordered sample vector
remain unchanged in `/api/observation`. All-zero retained samples are included as
zero for arithmetic averages; they cannot supply a positive geometric mean.
