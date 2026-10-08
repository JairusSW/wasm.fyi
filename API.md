# wasm.fyi API

The API stores current and source-pinned historical WebAssembly benchmark measurements. Its contract is defined
by [OpenAPI](schemas/api-v1.openapi.json), [JSON Schema](schemas/benchmark.schema.json)
and [generated TypeScript types](src/lib/api/benchmark-types.ts).

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/platforms` | Discover measured platforms |
| GET | `/api/benchmarks` | Page results for one platform and phase |
| GET | `/api/history` | Page source-pinned history for one platform and phase |
| POST | `/api/captures` | Publish a complete capture atomically |
| GET | `/healthz` | Database readiness |

These are the only active routes. Old `/api/v1/*`, `/admin/v1/*`, offset pagination
and evidence/report endpoints have no compatibility aliases and return HTTP 404.

## Read

```sh
curl http://localhost:8080/api/platforms
curl 'http://localhost:8080/api/benchmarks?platform=PLATFORM_ID&phase=steady'
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
latency. Latency excludes warmups and unverified samples and uses the median of
per-launch medians. The callback loop is normalized per boundary call. RSS comes
from timing-process exit, outside measured samples. Transpiler compilation uses the maximum kernel-accounted translator/compiler child peak, including waited-for descendants, rather than the adapter peak or a sum. The maximum across measured trials is retained. Older transpiler captures may contain adapter-process RSS and need recollection for this definition; saved historical values are not rewritten. Compilation latency includes translation and native compilation/linking. Code size reuses the compiled transpiler artifact outside latency timers when available; otherwise it uses one cold compile pass; full images include embedded data. `codeKind` distinguishes `native-image` from `engine-reported`; unavailable code
has a null kind and displays `n/a`. Linked transpiler code sizes include executable bridge/runtime sections; they are not guest-only instruction counts. JavaScript native code is `n/a` when the embedding cannot expose attributable code. Old records without a definition return `unknown`, never an
inferred native image. New successful code captures must supply a known kind.
Do not treat sizes with different definitions as equivalent. No raw samples or
images are retained.

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
cells remain intact. Older or equal-time retries are ignored, making replay safe.
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
