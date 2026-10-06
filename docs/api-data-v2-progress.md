# API/data v2 implementation checkpoint

This branch implements the first producer/service vertical slice of the [October 5 plan](plans/wasm-fyi-api-and-data-plan-v2-2026-10-05.md). It does **not** cut the existing frontend over to the API. Its layouts, controls, collection defaults, and existing Pages publication remain unchanged. Removing the global `measurements.json` import is still the next frontend milestone.

## Source identities

| Identity | Revision |
| --- | --- |
| Plan-reviewed site | `daf09f4810cd8229e521c462c93eae4292db306e` |
| Plan-reviewed deployment | `101850b696fdfbb4a5c8926b188ba4947e111a3b` |
| Site implementation base | `d84cdf6ab9e51734951dfc20359631a703cf4589` |
| Producer implementation base | `a017c56fef370a54ffa33ca49ad9b6827e127cc4` |
| Existing configured producer pin | `0509a0a323f41c58a2f2db15a372fb2e63c692bf` |

The recorded [payload audit](plans/wasm-fyi-audit-2026-10-05.json) is the supplied deployment baseline, not a new HTTP/browser measurement. No benchmarks or production imports were run for this checkpoint. The main checkout's ongoing data/history work was left untouched.

## Implemented

- Producer `wasmbench export-site --report REPORT --out NEW_DIR`: independently verifies with the installed builder, copies scientific summaries without recomputing statistics, exports exact catalog identities, and keeps samples/observations in independently decoded objects. Legacy reports are untouched. No archived executable is run.
- Objects have full SHA-256 names, at most 256 KiB decoded; small root inventories have at most 512 objects; larger inventories use at most 512 independently verified pages of 512 payload descriptors. An import accepts at most eight report exports and remains subject to the job-manifest and pending-byte budgets. Oversized individual records fail explicitly. Artifact descriptors are at most 10 KiB decoded.
- Timing versus separate memory-pass provenance, original trial/block IDs, zero values, absent intervals, source report/seal hashes, actual controller hash, and separate analysis version fields survive conversion. Exact code-size integers outside JavaScript's safe range use decimal strings.
- A size-only code record remains measurable. Native bytes and inspection are explicitly unavailable in this transport, even if the original report contains an image. No content hash or download is advertised for absent export bytes.
- One Go service owns Pebble v2.1.7 and the local content directory. Publication installs/syncs objects and portable revision roots first, then synchronously commits the revision, idempotency record and current pointer, then exposes the revision to readers. A durability-uncertain commit prevents further publication until restart.
- Immutable radix-map nodes path-copy only affected branches. Current and previous measurements are selected per exact environment/track/contract/metric/profile/scenario cell. Older deliveries go into history without replacing newer measurements. Unchanged nodes and canonical records are reused; result IDs are not duplicated as new history observations.
- Authenticated staged job imports, paged missing objects, missing-only upload and idempotent commit. Failed/unsupported *completed* jobs are admissible; interrupted jobs and unresolved references are rejected. Public direct IDs and sample chunks must be reachable from a published revision.
- Core bounded JSON reads: manifest, revision chain, catalogs, selected results, report/result/artifact descriptors, recorded result history and sample chunks. Sorting is over the full bounded candidate selection before pagination. HMAC cursors bind revision, normalized filters, sort, limit and position. Ordinary JSON has a 1 MiB decoded ceiling and byte-aware continuation.
- Gzip representation validators, revalidated default-current URLs, immutable explicit-revision URLs, an eight-request admission limit, and bounded Pebble cache/memtables. Dependency closure excludes all harness packages and SQLite.
- Coordinator `--api-url ORIGIN` stores the destination in the immutable plan. It retains stop/resume, completed-job skip, parent-bundle verification and per-corpus publication. The token remains on the coordinator. API mode publishes data without committing it or triggering a Pages rebuild; default behavior stays on Pages.
- [OpenAPI](../schemas/api-v1.openapi.json), [JSON Schema](../schemas/site-v2.schema.json), generated frontend wire types, and an isolated revision-bound client with explicit reads, a 32-entry/4 MiB cache, stale-response rejection, abort support, and decoded-byte limits. Existing components are not wired to that client yet.

## Contract gaps and remaining gates

The source uses `native.code_size` in code records but omits it from `metrics.Registry`. This export emits a **missing-definition marker**, not a fabricated definition. Result `metricDefinitionStatus` is `unregistered`; measured size is retained. An upstream registry addition needs compatibility review because registry changes affect existing report verification.

Environment and contract IDs currently preserve full locked source records. They are deliberately conservative; a site environment-comparability policy and workload identity normalization still need fixture-backed review. This service's cell selection is not yet a replacement for the website's release filtering, special call-probe selection, custom cohorts, average-RSS populations or retrospective history roles. Raw history here is recorded-result history, not the website's policy-derived retrospective series.

Collectors, boundaries and denominators remain in recorded observations and the canonical metric registry. Before UI cutover, expose their complete selector identity and validate cohort compatibility. Preserve the site's additional analysis policies separately rather than treating this store's generic result selection as statistical parity.

Remaining work:

1. Current sealed corpus fixtures and parity for multi-report selection, average RSS populations, custom weighted aggregates, exact retrospective history, reused evidence and changed workload contracts.
2. Lazy frontend route/component integration, catalog selectors, metadata-derived explanations, and removal of global measurement/report/history loads. Measure actual initial-page traffic, JavaScript size, heap and request count; synthetic small-page tests are not a production budget guarantee.
3. Indexed narrowing of candidate scans. This first service caps traversal at 100,000 keys but walks the bounded persistent map before filtering. It returns a scope-limit error when exhausted; it is not ready for the complete deployed inventory's query load.
4. More detailed producer evidence exports (throughput, warmup diagnostics, timelines, engine traces, scaling), progressive native extraction/disassembly, and archival parent-bundle download resources. The parent bundle's identity is preserved; its large archive is not uploaded by this sink yet.
5. Portable rebuild/backup/restore commands, retention/GC leases, observability, rate limits by caller, operator qualification, public admin ingress hardening, frontend hosting and crawler/deep-link fallback.
6. A published producer commit/release and a deliberate new configured pin. No cross-repo Go import or workspace replacement is used, but the existing pin does not include `export-site`. Do not run API collection mode with that old binary.

Integrity is SHA-256 verification of imported bytes. Source verification is an assertion made by the authenticated producer; the service does not independently recompute unavailable source evidence. Revisions expose `trustedPublisher`, `byteIntegrity`, `sourceVerification` and `operatorQualification` separately. Qualification remains `not-checked`.

## Local development

From the producer worktree, build the changed command:

```sh
go build -o /tmp/wasmbench-site-v2 ./cmd/wasmbench
/tmp/wasmbench-site-v2 export-site --report /path/to/verified-report --out /path/to/new-export
```

From `wasm.fyi/service`, use a private data directory and a token of at least 32 characters:

```sh
export WASMFYI_ADMIN_TOKEN='your-private-long-development-token'
go run ./cmd/wasmfyi --data /path/to/private-api-data --listen 127.0.0.1:8090
```

After publishing/pinning the producer changes and preparing the normal collection workflow:

```sh
just bench --api-url http://127.0.0.1:8090 --corpus qoi --machines local --workers 25%
```

`--no-live` still retains outputs without publishing. A saved session cannot silently switch publication destinations. API mode requires the new producer command; credentials are neither placed in the plan nor transferred to workers. HTTPS is required for non-loopback publication.

Read examples:

```sh
curl http://127.0.0.1:8090/api/v1/manifest
curl 'http://127.0.0.1:8090/api/v1/results?revision=REV&selection=current&metric=time.wall&statistic=median_ns_per_operation&limit=100'
```

Use the returned revision for all subsequent reads and carry the same normalized filters with each cursor. An unreturned page is not an unmeasured cell. Use `/results/ID/samples` for chunk references and `?chunk=SHA256` to load one referenced chunk.

## Validation

```sh
cd service
go test -race ./...
go vet ./...
cd ..
node scripts/check-api-dependencies.mjs
node scripts/generate-api-types.mjs --check
node --test scripts/api-publication.test.mjs scripts/benchmark-workflow.test.mjs
pnpm exec vitest run src/lib/api/client.test.ts
```

Producer checks run `go test ./publish ./cmd/wasmbench`. The golden fixture is synthetic, emitted by the producer's `TestSiteExportParityAndBounds`; it is not performance evidence. Producer tests also export a fully verified report fixture and compare every timing summary field with its source. Storage tests cover publication-stage failures/restart, hidden staging IDs, concurrent duplicate deliveries, current/previous/backfill semantics and persistent-map sharing. HTTP tests cover signed cursors, scope tampering, compression, source-byte limits, unavailable downloads and missing/corrupt inputs. An end-to-end test starts the real service and drives the coordinator sink without executing benchmarks.

Pebble's batch and filesystem durability are separate; see the [pinned Pebble documentation](https://pkg.go.dev/github.com/cockroachdb/pebble/v2@v2.1.7). Backing up only its DB directory is insufficient for this content-backed service. Operations tooling is pending; this is a development checkpoint, not a production cutover.


## Backend hardening pass

The next backend pass adds immutable session, machine-member and attempt bindings;
conflicting redelivery returns 409. JSON ingestion rejects duplicate keys as well
as unknown fields. Content reads enforce their size before allocation, reject
symlinks and swapped inodes, and install without overwriting existing files.
Filesystem retries re-establish durability rather than assuming existence proves
it. Public responses use safe structured errors for invalid input, missing scope,
limits, conflicting identities, and durability failures.

Persistent dimension and catalog-kind indexes let selected queries avoid unrelated
cells and descriptors. Catalog paging loads only the returned records. Requests
honor cancellation and have an internal 32 MiB selected-result byte budget as well
as the ordinary response and scan ceilings. Earlier unindexed revisions remain
readable; the first subsequent publication builds their missing indexes rather
than silently dropping their data. Full large-inventory scale tests remain open.

A durable `published.json` pointer is installed after the synchronous database
commit and before exposing its revision. DB-free rebuild follows that pointer's
immutable ancestry; it cannot promote abandoned staging/index roots. Startup
checks the committed ancestry and shared content closure before serving.

Offline operations are now available (only one process may own the database):

```sh
wasmfyi backup --data /private/live-data --output /private/new-backup
wasmfyi verify-backup --data /private/new-backup
wasmfyi restore --data /private/new-backup --output /private/new-data
wasmfyi rebuild --data /private/new-backup --output /private/rebuilt-data
```

Backups contain a synced Pebble checkpoint detached from live hardlinks, every
referenced published content object, available staged-import content, the durable
pointer, and the private cursor secret. Bounded inventories checksum every file;
verification rejects corrupt, unlisted and symlinked resources. Restore preserves
pending imports through the checkpoint; content-only rebuild reconstructs
published state and idempotency receipts without the database. Neither command
replaces an existing destination, including a destination created concurrently.
Atomic non-replacing directory installation is implemented for Linux and macOS;
other platforms explicitly reject this operation.

The service drains requests on SIGINT/SIGTERM, cancels obsolete work, and retains
its durable cursor key across restarts/restores. Direct non-loopback listeners
require TLS; a loopback listener can sit behind an operator-managed HTTPS proxy.
The dependency closure still excludes SQLite and all harness execution packages.

These changes passed local race tests, vet, command-level recovery tests and the
real-service coordinator publication/resume tests. Docker is unavailable here, so
this pass does not claim a Linux runtime test or CI result. See the current
[backend completion audit](backend-acceptance.md) for the still-open producer,
scientific-policy, query-scale, artifact, online-operations and hosting gates.


## Admission, cleanup and abrupt-crash gates

HTTP object uploads now require a permit from an active staged manifest, including
the exact declared digest and size. Shared objects retain permits until the last
pending import releases them. Reservations are idempotent and released in the
same durable batch as publication or an explicit abort. Defaults permit at most
128 pending imports, 512 MiB of declared pending bytes, and 50 GiB of content
storage; `--max-pending-jobs`, `--max-pending-bytes` and `--max-content-bytes`
configure those limits. Content accounting includes quarantined payloads across
restart. These are content/pending budgets, not a promise to bound every byte in
Pebble, backups or the host filesystem.

`GET /admin/v1/imports/ID` returns bounded publication progress; `POST
/admin/v1/imports/ID/abort` releases reservations without altering published
revisions or rewriting immutable attempt identity. `/healthz` and `/readyz`
distinguish process readiness from the presence of a published dataset. The
protected `/admin/v1/metrics` reports pending/content/database bytes and
compaction state without tool paths or evidence inventories.

Cleanup is preview-first:

```sh
wasmfyi gc --data /private/data
wasmfyi gc --data /private/data --apply
```

It retains all published revisions and active imports. Unreferenced hash-named
objects must pass a 24-hour grace period before quarantine, then a seven-day
quarantine interval before deletion. Each deletion needs a validated receipt
and fresh reachability marks. New imports can rescue quarantined objects;
unknown filenames are counted and preserved. Backup/cleanup/publication are
serialized by the database owner, so cleanup cannot remove files while a backup
is being assembled. No historical revision retention policy is enabled yet.

Subprocess tests abruptly exit at `files`, `indexes`, `before-commit`,
`after-commit` and `after-portable`, reopen the actual Pebble database and check
publication/history boundaries plus duplicate delivery. ENOSPC injection after
content sync and installation checks that retries re-establish durable content
and never expose a partial dataset. These tests do not fill the real machine's
disk. Further backend scientific/producer/API/scale gates remain in the audit.


## Producer context and evidence closure

The export manifest records the producer's actual executable SHA-256 separately from the collecting
runner SHA-256 and includes available module/Go/VCS build identity. Pass manifests
and admission records are referenced evidence: exact lock/options, host facts,
pass IDs and recipes survive conversion. Trial details retain diagnostic log,
start/duration, isolation and recorded diagnostic fields; adapter samples and
phase events have independent array chunks. Launch medians and warmup diagnostics
are preserved in explicit evidence instead of being dropped from the transport.
None of these additions recompute numerical summaries or create launch values.
Native `code_image` payloads still await binary transport and remain excluded.

`/reports/ID/evidence` lists pass-context references or reads an explicitly
selected chunk. Selected-result evidence reads follow only that result's references, with request
cancellation and scan/decoded-byte limits. Ingestion rejects malformed or unresolved
links, including report-level pass contexts. Startup validation, backup/rebuild and
cleanup follow the same reference format. Tests cover nested resources, unrelated
digest rejection, cancellation and content-only recovery. Legacy evidence objects
remain readable. Root inventories, individual diagnostic objects and analytical
exports retain the size limitations listed above.


## Paged producer inventories

Large producer exports now replace the inline payload inventory with independently
hashed inventory pages: at most 512 descriptors per page and 512 pages per root.
Each page declares its representation size, payload count and total payload bytes,
so an importer can reserve storage before expanding its permissions. Small export
manifests retain their existing encoding. A 2,000-trial producer fixture verifies
that the root stays below 50 KiB and that every trial, result and payload survives
paging with exact hash/size/count commitments.

The service now admits these roots and reserves page plus payload bytes at
submission. Page uploads have an `inventory` kind in the missing-object list.
The coordinator uploads each page and posts
`/admin/v1/imports/ID/inventories/DIGEST` before uploading its leaves. This verifies
hash, byte size, payload count, total payload bytes and descriptor kinds before
synchronously installing permissions. Cached pages also require attachment for
each import; submission does not expand a whole large inventory in one request.
Permissions have per-import owners, so shared pages and aborted imports cannot
leak grants or revoke another import's uploads. Legacy permit accounting migrates
from canonical staged jobs. `pendingInventories` and `missingComplete` qualify
progress while the complete leaf inventory is still unknown.

Publication requires all pages and payloads; startup validation, conservative
cleanup, partial backups, restore and DB-free rebuild follow the page references.
Tests publish more than 512 payloads through the real coordinator/service, confirm
that repackaging does not duplicate history observations, and cover pre-page
permission denial, full quota reservation, mismatched commitments, all-or-nothing
permission batches, shared grants/abort, migration, restart and recovery. Existing
small manifests remain compatible. Large individual pass contexts, diagnostic
records and result reference lists still need their own chunking; inventory paging
alone does not solve those limits. Broader scale and abrupt-process tests for this
new admission path remain open.


## Large JSON evidence resources

Oversized evidence objects, including pass contexts, trial diagnostics and single
array rows, now become `json-resource` descriptors with ordered `json-fragment`
references. Each fragment carries valid UTF-8 text; concatenation restores the
original JSON bytes before parsing. Fragments are at most 120 KiB of text and
remain below the 256 KiB object ceiling after JSON escaping. A resource has an
explicit 64 MiB byte ceiling and at most 1,024 references. Ordinary responses
return descriptors or one fragment; the server does not assemble large evidence
on HTTP reads. Small evidence encoding remains compatible.

Import verifies every resource's referenced fragment kind, full content hashes,
original byte count, original SHA-256 and valid JSON without duplicate keys.
Startup/recovery closure validates the same representation. Explicit client
assembly verifies bytes and SHA-256, honors cancellation and never runs during
ordinary result reads. Producer tests preserve large Unicode/escaped pass recipes,
logs and oversized phase rows byte-for-byte; service tests cover integrity failures
and nested recovery, and client tests cover tampering, ceilings and cancellation.
A directly linked fragment is authorized without scanning all sibling fragments.

This resolves oversized evidence values, not oversized canonical catalog/result
records. Those records still have the original decoded ceiling; large result
reference lists and larger-than-64-MiB evidence need additional representations.
Native bytes use the separate binary path described below.


Exact exporter identity belongs to the export receipt/manifest, rather than the
canonical scientific report record. Re-exporting the same sealed source with a
different executable must not cause an immutable report collision. Legacy roots
without this optional identity remain readable; new producer exports include it.


## Native producer export

The producer now exports admitted original native bytes under their complete hash,
with a 16 MiB ceiling matching the existing harness code-image contract. It reuses
native export admission and validates module/image identity, runtime/workload/trial
bindings and reported image length. Withheld records and engine-size-only cases do
not acquire byte downloads. Artifact descriptors link separate metadata and bounded
function lists, preserving attribution and the harness's interpretation. Disassembly
remains unavailable until an offline derivative is exported.

Producer tests cover a binary larger than the ordinary JSON ceiling, exact bytes,
function attribution, descriptor limits, hash/module/runtime/size mismatches, failed
export cleanup and withheld-content rejection. Consumer storage, serving, recovery and observation identity are described in the
following sections. Adding downloadable bytes or changing evidence
encoding must not turn an existing capture into a new independent observation.


## Observation identity and representation updates

New revisions record `observationPolicy: source-summary-v1` and a reusable
`observationRoot`. An observation hashes its exact source report/seal identity,
configuration, contract, environment, metric definition, scenario/profile,
statistic, analysis version, creation time and scientific summary. Detailed
evidence links and the summary's artifact descriptor reference are representation
fields and do not create an additional capture.

Representations remain immutable canonical records. Each revision resolves a
capture to a preferred representation, favoring available content, available
inspection, then evidence presence; canonical ID order breaks equal-rank ties.
Late richer evidence can update a historical/previous capture without advancing
current/previous measurement selection or adding history. A poorer redelivery
cannot downgrade it. Older revisions retain their original representation map.
Legacy revisions remain readable; the next publication indexes their existing
result records into this policy. Distinct source/configuration/contract/definition,
analysis or scientific-summary changes remain distinct observations.

Tests cover an older capture enriched after a newer measurement, unchanged history
counts and selection populations, immutable older views, poorer redelivery,
DB-free rebuild, legacy-index migration and distinct scientific identities. This
identity policy applies to the same exact sealed report; reuse across separately
rebuilt source reports and retrospective history/cohort policies still need their
explicit source-pass/sampling-group work. Binary publication uses this policy and the storage/serving path below.


## Native binary service path

The service/coordinator now admit `binary` objects up to 16 MiB; JSON evidence,
records and inventory pages retain the 256 KiB decoded ceiling. Declared sizes,
full hashes, upload permits and pending/content quotas apply to binaries too.
Available artifact content must reference a declared binary of the recorded size;
unavailable descriptors may not advertise hashes/downloads. Artifact/result
report, runtime and workload bindings are checked. Metadata references must be
present evidence. Empty binary originals remain available content, distinct from
missing bytes. JSON APIs cannot read a large binary through an evidence reference.

`/artifacts/ID/content` (also `/bytes`) with a single validated HTTP Range or
`?offset=N&length=N` returns at most 1 MiB of a selected image;
`?download=1` explicitly returns the original with attachment headers. Every read
checks revision membership and full original integrity before serving. Byte-window
ETags include offset/length; raw bytes are never JSON/base64 or disassembled on a
request. `/artifacts/ID/inspection` loads referenced image metadata, with `chunk`
for a linked function/evidence resource. Unavailable content and unrelated hashes
return errors. Descriptor and normal result reads do not fetch binaries.

Recovery/cleanup paths retain binary ceilings separately from metadata ceilings.
Tests cover declared-object upload, content completeness, binary sizes above the
JSON ceiling, exact selected/full reads, caching/query errors, corrupt originals,
empty originals, restart, backup/restore, DB-free rebuild and unchanged history
when bytes are added. The real-service coordinator test publishes/downloads a
binary and verifies duplicate redelivery transfers nothing. Whole selected images
are bounded to 16 MiB and verified in memory before byte reads; streaming larger
artifacts, offline disassembly derivatives and broader native scale/crash tests
remain future gates.


## Native inspection admission

Inspection metadata is now checked against the artifact's source report, trial,
image hash, architecture and version/attribution contract. Result-linked inspection
also matches the exact workload module SHA-256. Function shard references must
agree with their declared order, exist as evidence, and decode to actual functions.
Ranges must fit the original image, use unique Wasm indices and generation zero,
match the attributed backend, and not overlap. An available inspection needs actual
functions and exported content. Metadata and oversized function rows may use the
verified JSON resource representation. A missing/null byte count cannot silently
become an available empty original.

Service fixtures now include coherent module identities and full native metadata.
A fresh fixture emitted by the separate producer's native-export test imported
through the service, and its 400,000-byte original and function metadata remained
accessible. This is synthetic transport validation, not a real benchmark capture.
Reproduce that cross-repository gate with:

```sh
# Producer worktree: use a new output directory.
WASMFYI_NATIVE_FIXTURE_OUT=/tmp/new-native-export go test ./publish -run TestSiteExportNativeBinaryAndFunctionResources -count=1
# Service module:
WASMFYI_NATIVE_PRODUCER_EXPORT=/tmp/new-native-export go test ./internal/store -run TestFreshNativeProducerContract -count=1
```

Malformed metadata tests cover report/trial/module/image mismatches, absent
functions, overlapping/out-of-bounds ranges, duplicate indices and generations.
Materialization remains recorded producer evidence; the service does not rerun
compilation or infer instruction-only sizes or lifetime observations.


## Strict query contract

All API reads now parse the raw query with errors preserved. Malformed percent
encoding, semicolon ambiguity, duplicate fields, invalid UTF-8/NUL values, empty
scope parameters and unsupported route fields return 400 before dataset lookup.
Queries have a 16 KiB encoded ceiling, at most 32 distinct fields, 64-byte names
and 4 KiB decoded values. Revision/chunk parameters require full SHA-256 identities.
Manifest, health/readiness and authenticated admin routes enforce their own finite
parameter sets; details cannot silently ignore pagination parameters. Existing
current/previous and s1/s2 selection aliases remain valid.

Revision-list cursors now bind the requested page size, matching result/catalog
cursor scope. Tests cover malformed and ambiguous requests across routes, valid
aliases and page-size cursor tampering. This completes consistent parameter-set
validation for the implemented routes; additional endpoint contracts and per-caller
rate limits remain separate gates.


## Bounded peer request budgets

HTTP admission now uses bounded token buckets in addition to the existing eight
concurrent-request limit. Defaults are 60 public requests/second with a burst of
120, and 100 authenticated publication requests/second with a burst of 400.
Publication credentials select their separate budget; unauthenticated admin URLs
use the public budget. Transport IPs are normalized across ports and IPv4-mapped
addresses. Forwarding headers are ignored, preventing callers from minting budgets
with arbitrary headers. Behind a reverse proxy, its transport peer shares one
budget; configure suitable service limits and use the proxy's client limiter for
end-user separation. This service does not implicitly trust forwarded identities.

At most 4,096 peer/budget pairs are tracked, with five-minute idle expiration and
reserved publisher capacity. New public identities cannot evict active buckets or
consume the reserved slots. Rejections return 429 and Retry-After. CLI flags tune
public/publisher rates and bursts and `--max-request-clients`; invalid limits fail
startup. Tests cover bursts/refill, port/address normalization, state capacity,
idle reclamation, forwarding-header attempts, separate publication budgets and
reserved publisher capacity. The real coordinator/resume workflow remains passing.

## Backend application hosting

`wasmfyi serve --frontend DIR` optionally serves a fixed root-path application
build through the API's existing request budgets, concurrency admission and store
shutdown leases. Startup loads the regular, nonsymlink `404.html` application shell
(2 MiB maximum). Known top-level and proposal routes use that shell; measured
workload routes resolve through immutable revision postings without decoding
results or the global catalog. New data therefore does not select stale
prerendered measurement HTML. Unknown workload routes and missing assets return
404; lookup failures return 503. Legacy unindexed dataset generations require
indexed republication before workload routing.

Static assets use an `os.Root`-confined directory with ancestor symlink rejection,
regular-file/inode checks, a 64 MiB file ceiling and no directory listing or HTML
fallthrough. `_app/immutable` assets have immutable caching; application shell and
other files revalidate. GET/HEAD, conditional shell requests and selected static
ranges use standard HTTP serving. API/admin namespaces retain their API routing.
The build directory must stay immutable during service lifetime.

Tests cover routes containing spaces and nested workload names, new known routes,
missing assets/workloads, traversal, symlink files/directories/shells, stale HTML,
method/HEAD/cache behavior, reserved namespaces and shared rate admission. This is
backend hosting evidence only: current Svelte components still load the bundled
snapshot and do not yet resolve newly imported workloads through the API. Crawler
reference pages, lazy client rendering and production cutover remain separate
acceptance gates.

## Website comparison policy parity

The storage-independent selection/weighting functions now live in
`src/lib/comparison-policy.ts`. Existing aggregate and history consumers retain
their exports, layouts and calculations. `service/internal/comparison` implements
the corresponding shared-workload geometric mean, equal-workload/equal-corpus
weighting, available-boundary-cell arithmetic RSS policy and a separately named
matched-boundary-cell arithmetic policy. Inputs require an explicit baseline,
exact row keys, recorded corpus groups when used and result/report references.
The future store adapter must build keys from compatible exact contracts and
measurement selectors; logical names cannot establish equivalence.

Output retains requested/participating/omitted configurations, baseline identity,
every member and weight, per-configuration report identities, boundary-cell and
logical-workload counts, available values and nullable ratios. Missing baselines
never select a substitute. Available-cell RSS retains unequal populations; matched
RSS is a distinct policy. Unsupported cross-report aggregate intervals remain
unavailable with a reason under `wasmfyi-cohort-v1`; the legacy browser bootstrap
has not been changed by this extraction and requires its own methodological
review during consumer migration.

`scripts/cohort-parity-fixture.mjs` evaluates the existing website aggregates over
the generated digest-checked view and freezes six host/weighting/RSS fixtures in
`service/testdata/cohort-current.json`. Source hashes identify the exact view and
policy code. These legacy fixture contract/result keys are explicitly labels,
not reconstructed producer contracts or new independently verified evidence.
Go tests compare values, ratios, counts and report membership against those
existing website results. Separate cases cover mismatched exact-contract keys,
unequal/matched RSS populations, omitted configurations, absent baselines,
nonpositive/nonfinite/missing measurements, duplicate cells, cancellation and
detached membership values. Regenerate/verify with:

```sh
node scripts/view-data.mjs
node scripts/cohort-parity-fixture.mjs          # verify frozen current-site input
# Only after reviewing changes to source values and policies:
node scripts/cohort-parity-fixture.mjs --write
cd service && go test -race ./internal/comparison
```

The current site aggregate/history suites (36 tests) still pass after extraction.
This is the comparison policy layer, not an implemented `/aggregates` or
`/cohorts/{id}` endpoint: canonical producer-summary selectors, compatibility
checks, bounded membership pagination, method-aware caching and precomputed
overview scopes remain required before those serving gates are complete.

## Producer-owned measurement selectors

Results optionally expose `measurementMethod` and `measurementMethodId`; new
exports always provide them, while legacy records remain readable. The producer
projects the actual source pass's locked recipe and contributing memory
observation identities, including collector/version, phase, quality, profile and
normalization denominator. It reuses the report builder's observation eligibility
function and contributing trial set; it does not recompute values or intervals.
Trial-scoped RSS remains one observation per timing trial. Timing/native collectors
absent from the source are explicitly `not_recorded`, never inferred. Missing pass
contexts produce unavailable descriptors.

The normalized recipe removes suite labels and unrelated scenario selections,
retains this scenario's sample override, protocol, runner, resource/host policy
and budgets, and preserves unsafe integer seeds/durations as decimal strings.
Descriptors are capped at 64 KiB, recipes at 32 KiB and observation identities at
32. The service checks field/digest/profile/scenario bindings at import and during
portable closure verification. `/results` and `/history` accept an exact full
`method` digest, backed by persistent postings and query-bound pagination. Legacy
records do not silently acquire matching methods.

The source-summary observation policy excludes this extracted representation
metadata from capture identity and prefers available method enrichment. Tests
prove a reexport preserves six historical captures, current/previous selection
and old revisions through restart, backup and DB-free rebuild. A fresh separately
emitted native producer fixture also imports with method descriptors and exact
method-filtered result membership. This fixture is synthetic transport evidence.
Producer tests cover source collector changes, recipe scheduling independence,
exact seeds, profile mismatches, missing/duplicate passes and unchanged verified
source statistics.

The method descriptor is the compatibility input, not an implemented cohort API.
Complete scientific compatibility policy, editorial workload groups, bounded
cohort resources, caches and overview precomputation remain open backend gates.

## Revision-scoped aggregate and cohort resources

`/api/v1/aggregates?scope=<URL-encoded JSON>` now adapts complete producer result
selections into the comparison policies before membership pagination. The typed
scope pins an environment, revision, selection, exact configuration or track
lanes, baseline, metric-definition/method digests and analysis versions. Explicit
policies control editorial weighting, feature probes, contract revisions, mixed
exact configurations, missing collectors and the source's unregistered native
size marker. Unknown methods do not become empty "not measured" populations.
RSS arithmetic views require current-RSS definitions and recorded observer
identities; peaks and other memory domains cannot enter those views.

The adapter preserves source headline timing eligibility, failed-launch exclusion,
uncached compile admission and complete independent memory-launch coverage. It
does not compute scientific summaries from samples. `latest-in-scope` chooses the
newest exact contract per logical workload across the selected environment and
methods before lane filtering; equal latest timestamps with different contracts
are ambiguous and rejected. `all-exact-contracts` is a separately explicit policy.
Track scopes reject mixed exact configurations unless the scope requests explicit
membership. Members expose their actual configuration/contract/method/definition
and result/report IDs; they retain the canonical source number/string alongside
the floating approximation used for comparison calculations.

Summaries omit full member/report inventories and expose population/coverage
counts. `/api/v1/cohorts/{id}` returns selected membership pages, with signed
cursors bound to the frozen revision, normalized scope, selected lane and page
size. Cohort IDs carry an authenticated, versioned scope instead of depending on
an ephemeral cache or a permanently held Pebble snapshot. The durable cursor key
allows those IDs to reconstruct after restart, backup and DB-free rebuild.
Persistent method/definition postings resolve descriptor metadata without global
result/report loads; older indexed revisions have a bounded fallback.

Scope JSON is limited to 4 KiB; two concurrent cohort computations share the
existing outer request admission. Computation limits include four selectors,
32 lanes, 10,000 exact rows, 100,000 cells and 32 MiB of decoded selected records.
A method-aware cache holds at most 16 scopes under a conservative 32 MiB
representation/structure charge. Oversized results remain reconstructible without
cache retention. Member pagination slices references directly and enforces the
ordinary 1 MiB decoded response ceiling. No requested subset uses the first page
as its aggregate cohort.

Tests cover merged reports, frozen scope across publication/cache loss/rebuild,
cursor tampering and lane/page-size changes, incompatible analyses/collectors,
mixed configurations, differing contracts, failed outcomes, unequal/matched RSS,
unregistered native sizes and exact unsafe-integer membership. Editorial category
classification matches 85 frozen cases from the existing JavaScript policy;
unknown applications are never guessed for corpus weighting. Canonical metric
and runtime-track bindings are now also checked during import. Representative
sealed real-data serving parity, default overview precomputation, broader scale
measurements and production cutover remain open.

## Real-source parity and batched immutable indexes

Three existing complete harness reports were verified and exported with the
installed producer built from the development worktree: Wasmer call probes,
Deno call probes and Wasmer native-size coverage. Transport-only directories in
the website workspace lack `raw/checksums.json` and cannot establish this gate.
The original evidence was read-only; no collection, archived verifier execution,
or benchmark-method change occurred. Wasmer and Deno record different environment
identities (`GOMAXPROCS` differs), and the gate preserves that distinction.

The opt-in `TestRealProducerServingParity` imports these exports through declared
objects and paged inventories into a temporary service database. It compares
source timing/memory summary JSON after removing only detailed diagnostic arrays,
retains exact integer native sizes and verifies unavailable bytes cannot acquire
hashes/downloads. It checks selected exact environment/track/method cohorts and
their HTTP summary/member surfaces. The three-report run passed with 592 timing,
729 memory and 145 native-size measurements, across six timing scopes. The native
report contributes 7,453 objects and 147 artifact descriptors with unavailable
content/inspection. These records prove source-value transport/serving fidelity,
not a new performance claim or deployment qualification.

That gate first hit the ten-minute test timeout while writing intermediate
catalog/posting roots. Publication now applies grouped radix-map updates, writing
only final changed branches and retaining shared old branches. The canonical
roots match sequential construction exactly. A 200-entry regression requires
over four times fewer files and checks immutable old roots, incremental updates,
idempotency and cancellation. Real import/serving subsequently completed in
253.95 seconds on this host. This is a local gate duration, not a general ingest
throughput guarantee; broader load/memory bounds remain open. File synchronization
and synchronous publication barriers were retained, and abrupt-process crash,
disk-failure and retry tests pass with the batched builder.

To repeat the external-data gate, independently verify/export complete reports,
then set `WASMFYI_REAL_REPORTS` to a JSON array of objects with `Source` (complete
report directory) and `Export` (fresh site-v2 directory) paths:

```sh
WASMFYI_REAL_REPORTS='[{"Source":"/absolute/report","Export":"/absolute/site-v2"}]' \
  go test ./internal/api -run TestRealProducerServingParity -count=1 -v -timeout=20m
```

The test skips without explicit inputs. Synthetic fixture association metadata is
identified as such; this gate does not claim the original collection coordinator
session/parent archive has already migrated into the API.

## Published session progress

Frozen `/sessions/{id}` and `/sessions/{id}/jobs` resources now expose the existing
collection hierarchy without embedding export inventories or evidence arrays.
Completed jobs gain small immutable summaries and per-session postings in the
same synchronous publication as their dataset revision. Older revisions use a
bounded ancestry fallback; the next publication builds the session index once.
Session/member/attempt bindings still come from the existing authenticated submit
path. Staged and aborted imports do not appear in these public views.

The summary reports the source plan hash, configured harness pin, published-job
count, distinct published machine/corpus count and observed member count.
`publishedJobs` counts attempt records; `publishedCorpusJobs` counts each
machine/corpus pair once, including completed failed or unsupported outcomes.
Retries and repackaged evidence do not inflate corpus coverage. Neither count
implies that the full planned collection finished. Legacy deliveries without
locked plan content retain null planned-job count and collection completeness,
with a recorded reason. Verified plan content enables published-coverage counts
as described below; live worker events are not yet indexed. A publication count is
not mislabeled as collection completion. Job pages show session/member/corpus/
attempt identity, parent bundle hash, small report references, collection status
and publication time. No archive download availability is inferred from a hash.

Pagination sorts by machine/corpus/attempt/job identity before selecting a page;
signed cursors bind session, dataset revision and page size. Short-lived reads
have key/decoded-byte/response limits and cancellation. Portable closure verifies
summary bindings against canonical source jobs; backup and DB-free rebuild retain
the same progress. Tests cover old frozen views, staged/aborted exclusion, unknown
sessions, cancellation, cursor scope changes and portable reconstruction. Distinct
corpus counts are also checked across retries, multiple machines, restart and
DB-free reconstruction. Full
pre-job plan registration and live worker/attempt states remain required
coordinator/backend work. Parent archive resources are now available as described
below.

## Bounded historical time windows

History reads now accept paired `from`/`until` RFC3339 instants with inclusive
start and exclusive end. UTC normalization makes equivalent timezone spellings
share cursor identity. Invalid/reversed/empty ranges and windows exceeding 120
UTC months are rejected; ordinary current-result queries cannot silently ignore
those fields. Revision, normalized window, filters and page size remain bound to
the signed pagination cursor.

Publication builds reusable per-cell/month observation postings with the same
batched immutable maps as catalog indexes. Entries retain exact result references
and source observation identity; representation enrichment resolves through the
existing alias root and does not add launches. The first indexed publication
bootstraps older source records under key/decoded-byte limits. Older revisions
use the bounded history-chain fallback. Window reads look up selected month
postings and filter timestamps before decoding source records, with context and
scan limits across all month lookups.

Portable closure validates posting timestamps, cell and observation bindings and
retains their record/evidence graph. Tests cover month boundaries, inclusive/
exclusive endpoints, timezone equivalence, frozen views after publication, cursor
mutation, invalid limits, cancellation and backup/DB-free rebuild. A private-test
revision with an unreadable old chain still serves the indexed selected month,
demonstrating that the window path does not depend on older chain objects. This
does not complete retrospective history roles or cross-report reused-evidence
policy; those remain distinct backend requirements.

### Online maintenance through the database owner

An optional `serve --control-socket /private/run/wasmfyi.sock` local Unix socket
allows backup and cleanup while the API owns Pebble. Its directory must already
exist with private permissions; the socket is `0600`, symlinked parents and
existing paths are rejected, and shutdown removes only its own inode. Filesystem
maintenance remains separate from public HTTP and publisher bearer credentials.

```sh
wasmfyi backup --control /private/run/wasmfyi.sock --output /private/new-backup
wasmfyi gc --control /private/run/wasmfyi.sock
wasmfyi gc --control /private/run/wasmfyi.sock --apply
```

The CLI takes this path before opening any database. Requests and responses are
bounded, only one maintenance request is admitted, and operations use the existing
serialized backup/cleanup algorithms with store shutdown leases and cancellation.
Backup checks cancellation before installing the completed directory. There is no
short response timeout for a large backup; caller cancellation and service shutdown
cancel the operation. Grace/quarantine policy remains 24 hours/seven days.
An abrupt exit may leave a stale socket; startup refuses to replace it automatically.

Tests keep the owner open while invoking CLI backup/cleanup, verify the backup,
rebuild its revision and cursor identity, reject unsafe socket paths, exercise
busy admission and a blocked request during shutdown, and run the actual serve
lifecycle. Larger backup inventories and concurrent publication/retention scale
remain separate acceptance gates.

### Complete-scope overview cards

`GET /api/v1/overview?scope=<URL-encoded CohortScope JSON>` now projects the
existing whole-cohort computation into small cards. Values, ratios, eligibility,
coverage and counts use the same selected population as `/aggregates`; no result
page or trial evidence contributes a substitute headline. Exact metric units and
versions accompany method references, requested/participating/omitted lanes and a
signed cohort link for paginated membership. The existing method-aware bounded
cache and two calculation permits are shared across these surfaces.

Interpretation text follows recorded policies: shared geometric workload/corpus
weights, available current-RSS boundary populations or matched RSS populations.
It reports source-report counts and unavailable aggregate uncertainty. Byte
integrity, producer-asserted source verification and unchecked operator
qualification appear separately as checks for the selected publication. A report
reference does not claim independently verified source derivation.

Tests use two report contributions and multiple workloads, check exact complete
point estimates and counts, forbid evidence/recipe embedding, enforce a typical
50 KiB decoded card-response budget, reconstruct a frozen scope after cache loss
and later publication, resolve unpinned current once, and validate linked member
pagination. Explicit scopes are required; popular preset selection and durable
publication-time overview precomputation remain open. OpenAPI and JSON Schema
record the new endpoint and response contract.

### Bounded result pagination and reusable query summaries

The result/history HTTP path no longer serializes and decodes the entire matched
result set to construct each page. It selects globally ordered rows and serializes
only the page, advancing the signed cursor at the ordinary response-byte ceiling
without dropping the remainder. Cursor-scope mismatches are rejected before query
execution. Totals and completeness continue to describe the full selection.

API summaries now retain the exact producer summary, result/report/configuration/
contract/definition identities and method digest while omitting full method recipes
and evidence inventories. Canonical result details and import validation remain
unchanged. `/api/v1/methods/{id}?definition=...&revision=...` uses the existing
persistent method index to resolve a selected recipe; an old publication cannot
resolve a method introduced later. JSON Schema distinguishes import records from
API summary representations, and OpenAPI describes selected method retrieval.

Normalized immutable selections share a 16 MiB/24-entry FIFO cache, conservatively
charged for data and structures. Page size affects cursor validity but not the
cached global ordering. Empty selections are reusable; oversized selections are
not retained. Two uncached selections are admitted at a time; canceled/error
queries are not cached. Cache keys freeze revision, current/previous policy,
filters, sort and normalized history windows. This does not remove the existing
100,000-key/32 MiB query limits or precompute popular overview scopes.

Tests cover byte/count bounds, oversize rejection, empty hits, cancellation,
uncached concurrency admission, exact decimal values, selected-row serialization,
byte-ceiling pagination without loss, method detail identity, old-revision method
isolation and cursor continuation after new publication. Wider measured resident
memory/host-load and query-scale gates remain open.

### Producer-derived report analysis sections

The producer now exports remaining derived `Dataset` JSON fields as named,
referenced evidence sections instead of discarding them. This includes throughput,
scaling, memory timelines, density footprints, phase CPU, counter displays,
CPU-stack summaries and future source fields. Core result/catalog/pass transports
remain in their existing formats; independent source analysis versions stay in
report metadata, alongside the source report schema. No website re-analysis is
performed. Each section envelope binds its report ID, source field and raw JSON.

`analysisSections` is limited to 64 field references under version
`source-fields-v1`. Large sections use the existing 64 MiB logical-resource limit
and independently readable 120 KiB UTF-8 fragments; ordinary objects remain under
256 KiB. Report evidence access, import reference validation, startup checks,
backup, restore, DB-free rebuild and cleanup all follow these roots. Legacy
reports without section references remain valid. Sections for a different report
or source field are rejected before publication.

Producer tests preserve populated future fields, a large Unicode diagnostic and
an integer above JavaScript's safe range without float conversion. Service tests
verify selected root/fragment authorization and exact reconstruction through
backup, restore, rebuild and conservative cleanup, with no additional history
captures. A fresh installed exporter verified the existing complete Wasmer/Deno
call reports and emitted 105 objects each; the serving parity gate preserved all
24 declared derived source fields through HTTP, alongside four timing and four
memory summaries and two exact cohort scopes. These remain archived report tests,
not new measurements. Standalone Parquet/trace/profile files and parent/archive
bulk resources are still separate pending work.

### Indexed native function pages

The producer's existing function shards now include `producer-order-v1` metadata:
ordered shard digests and exact row counts, bounded to 4,096 shards and one million
functions. Import and portable recovery validate each count against its source
shard, retaining the original module/wasm indices, offsets, lengths, tier and
generation. Existing shard references and legacy exports remain readable.

`/api/v1/artifacts/{id}/functions` serves bounded pages in that recorded order.
Cursors freeze revision, artifact and limit. Indexed reads skip all nonintersecting
shards; older metadata uses an explicitly bounded counting fallback. Totals and
completeness are independent of the returned page. Byte ceilings produce a next
cursor without dropping remaining rows. The endpoint loads neither original
native bytes nor disassembly, and unavailable attribution stays unavailable.

Synthetic tests cover cross-shard boundaries, descending source indices,
legacy/indexed parity, frozen cursor continuation after publication/handler
recreation, invalid query scopes, count mismatch rejection and portable rebuild.
A private test removes unselected earlier shards and the raw image after verified
publication and still reads the later indexed page, proving selected access.
A fresh separately emitted 400,000-byte native producer fixture imports and serves
its exact attributed function (wasm index 7, length 32). This remains synthetic
transport proof, not a measured performance claim. Offline disassembly, section
resources and wider native scale/crash gates remain open.

### Ingress fuzzing and lossless text validation

Transport decoding now rejects malformed UTF-8 and unpaired UTF-16 escape units.
Go's standard JSON decoder otherwise replaces those with U+FFFD, which can change
producer identities or evidence text silently. Valid Unicode, paired surrogate
escapes, escaped literal backslashes and raw scientific JSON remain unchanged.
Duplicate-key scanning uses number tokens rather than float64 conversion, avoiding
rejection or interpretation of an otherwise valid large raw numeric literal.

Fuzz targets cover JSON decoding plus typed job/method validation and resources,
query normalization and route restrictions, signed cursor round trips, native
ranges and compression negotiation. Two-worker 20-second campaigns completed
1,376,849 transport executions and 136,209 query/cursor executions without a crash
or invariant failure. This is bounded evidence, not exhaustive ingress coverage.
Fresh sealed Wasmer/Deno export serving parity still preserves 24 analysis fields,
four timing and four memory summaries through the stricter decoder.

A regression test also demonstrated that joining a public storage sentinel with
a filesystem error exposed the private path in public JSON. Known error classes
now emit only their fixed public message and code, retaining HTTP status while
omitting wrapped implementation details. Unknown/internal errors remain generic.
Stateful upload/publication fuzzing, proxy end-user rate policy and wider ingress
load measurements remain open.

### Stateful import lifecycle validation

`FuzzImportLifecycle` now generates bounded sequences over two real fixture
imports with shared CAS objects. An independent expected-state model checks
submission/idempotency, active-owner upload grants, partial and corrupt uploads,
commit retries, abort tombstones, immutable plan conflicts, pending count/byte
accounting, publication identity and restart. Verification runs after every
operation, including exact staged missing-object counts and persistent cursor
identity. Sequences also assemble and verify consistent backups while imports may
be incomplete. Inputs contain at most 24 operations and two backups.

The five explicit seed scenarios pass under the race detector. A two-worker
30-second exploratory run completed 10 generated executions; a fixed-count
campaign then completed 50 executions in 17.13 seconds without an invariant
failure. These are limited stateful test campaigns, not claims of exhaustive
coverage or service throughput. Existing abrupt-exit/failure injection tests cover
publication durability separately; concurrent and larger multi-inventory fuzzing
remain open.

HTTP rejection tests use a reader that records every body read. Unauthorized
publication, undeclared object uploads and unsupported upload query scopes return
the expected status without consuming the body or publishing a revision. The
backend's real lifecycle behavior passes these gates; no measurement or collector
methodology changes were needed.

### Executable schema and generated-type gates

A pinned, test-only Draft 2020-12 validator now checks emitted producer exports and
captured successful API JSON responses against local schemas. Export checks verify
object/inventory byte commitments and hashes, then validate result data, analysis
resources and native function rows. API tests optionally append actual responses
to a new `WASMFYI_CONTRACT_OUTPUT` JSONL file; the validator resolves their documented
OpenAPI responses with no remote schema retrieval. Format validation dependencies
are included, and negative tests reject missing provenance, invalid dates, recipes
inside summary responses and invalid native ranges.

This exposed a missing `/cohorts/{id}` success-body schema. Explicit cell/member/
page types now describe exact provenance, source values, weights and frozen scope.
The generated frontend types were also stale, and the generator converted nullable
numeric union types to `unknown`. Union generation now preserves number/null and
number/string/null types, with strict compile-time consumer checks. Existing client
and evidence-resource tests continue to pass; no UI layouts or controls changed.

Local validation checked 153 instances across legacy/fresh analytical/native
exports and captured API responses, including 12 responses with detailed endpoint
contracts. The larger existing native-size export plus Deno analytical export
added 3,402 schema checks. The existing API workflow now runs negative schema
checks, captures and validates selected endpoint fixtures, verifies generated types
and type-checks their nullable/exact-value contract. This workflow change is local;
no GitHub run, push or deployment is claimed. Scientific verification, admission,
reference closure and broader endpoint-schema coverage remain separate gates.

### Explicit reverse-proxy client rate policy

`serve --trusted-proxies <comma-separated CIDRs>` now opts public API/static reads
into a trusted-proxy rate identity policy. Only a configured transport peer can
attest exactly one valid `X-Real-IP`; malformed/missing or multi-value identities
are rejected before reading the request body. Untrusted peers ignore all forwarded
identity, and default serving still uses only transport peers. The upstream proxy
must overwrite incoming client headers and protect the trusted backend origin.
No forwarded chain or arbitrary caller-selected header is interpreted.

Public addresses are normalized so mapped IPv4 spellings cannot create extra
budgets. Authenticated publisher budgets remain bound to the transport peer, so
varying client headers cannot evade publication limits or consume its reserved
capacity. Health/readiness probes use transport identity without requiring a client
header. Startup limits trust to 64 validated, non-universal, unmapped CIDR prefixes;
constructed handlers copy their policy so caller mutation cannot widen trust.

Tests cover separate trusted clients, IPv4 alias reuse, spoofing by untrusted
peers, publisher isolation, IPv6 clients, invalid/duplicate/chained/ported/zoned
addresses, health probes, immutable constructor policy and rejected CLI trust
flags. This completes an explicit proxy policy implementation; real proxy
configuration/deployment, wider ingress load and distributed identity policy are
not claimed by these local tests.

### Source-owned sampling identities

Fresh producer results now carry optional, bounded `samplingGroup` provenance:
source pass ID/timestamp, source manifest hash, canonical trial-ID/trial-hash
population digest, trial-record count and runtime/workload/scenario/profile
binding. Report metadata, report-analysis version and exporter identity do not
create this group. Distinct pass identities or changed trial records produce
distinct group hashes, even when block numbers coincide. Missing source pass or
timestamp yields no inferred group. Timing includes its source outcome population;
memory uses the explicit contributing trial set. Trial-record count is not an
assertion about independent launch count.

The service validates descriptor digest/bindings on import and recovery, preserves
it in selected result summaries and carries its ID in cohort membership. Schemas
and generated types describe the field. Same-report observation identity strips
this provenance enrichment so adding it cannot manufacture another measurement;
representation selection prefers the enriched record when other evidence quality
is equal. Tests cover stable group identity across report-analysis changes,
different source passes with equal blocks, changed trial bytes, missing context,
invalid descriptor bindings and unchanged same-report observation identity.

A fresh installed producer verified and exported the existing Wasmer/Deno call
reports. Serving parity retains 24 source analysis fields, four timing and four
memory summaries with the new descriptors; external schema validation checked
184 instances. Full race tests and vet pass. These source identities establish the
input contract for the next versioned cross-report history policy; current history
remains report-scoped and aggregate uncertainty remains unavailable. Cross-report
capture aliasing and resampling compatibility are not claimed complete here.


### Cross-report source capture policy

New dataset revisions use `source-sampling-summary-v2`. Results with validated
sampling descriptors may share a capture across report IDs only when their exact
source population, capture timestamp, environment, configuration, contract,
metric/definition, analysis version, measurement-method digest and normalized
scientific summary match. Artifact links and evidence representations do not
create new measurements. Missing sampling provenance retains the legacy
report-scoped identity; no match is inferred from workload names or block numbers.
Different capture timestamps remain distinct pending a separate historical-role
policy rather than silently changing source dates.

Same-report legacy-to-provenance enrichment uses a bounded two-step resolution.
Each report-local alias stays bound to its own record; the shared source alias
chooses the richer representation. New publication upgrades the observation map
and recovers current/previous from distinct retained history captures. Existing
revisions, maps, history postings and cursors remain immutable and readable.
Portable verification accepts and independently checks both policy versions.

Focused race tests cover repeated captures in separate reports, independent
populations, scientific identity differences, previous selection, bounded history
windows, legacy map/selection upgrade, restart and backup/rebuild. Existing
verified Wasmer/Deno exports retain serving parity. This is capture deduplication,
not an aggregate resampling change; retrospective roles and matched-history
change policies remain open.

Mixed legacy records whose richer evidence competes with newly supplied source
provenance still need an explicit combined-representation policy and regression
gates; this change does not claim that migration case complete.


### Independent source proof and evidence preference

New revisions use `source-sampling-summary-v3` and a reusable
`sourceBindingRoot`. Each binding associates one exact report-scoped scientific
capture with the canonical record that supplies its sampling descriptor. Evidence
ranking is independent of the descriptor: a poorer provenance-only export can
establish source reuse without replacing the original evidence-rich result.
Summary reads enrich that selected record from the same-report proof; immutable
canonical bytes, result IDs and evidence links remain unchanged.

Publication rejects conflicting source populations or known method identities
for the same report-scoped capture. Portable verification checks the proof's
report/scientific binding, descriptor and method, its shared source identity and
preferred representation. v1/v2 revisions remain readable; migration rebuilds
only the new revision's maps and selections. Missing proof never creates an
inferred source match.

Regression tests publish an evidence-rich native result, then a poorer descriptor
export. Full and windowed history remain equal, selected evidence keeps its ID,
summary provenance is available, canonical bytes remain unchanged, and redelivery,
restart and backup/rebuild preserve both. Legacy unindexed/v1/v2 recovery and
negative report/summary/method/population proof bindings are covered. This closes
the previously recorded competing legacy evidence/provenance case. Historical
role/timestamp interpretation and aggregate resampling remain separate open gates.


### Sealed analytical-file transport

The installed harness exporter now projects the existing sealed Parquet outputs
as `report-file` canonical records plus 1 MiB binary chunks. It does not invoke
analytical writers or archived builders. A descriptor carries report identity,
original filename/media type, identity encoding, total bytes/full SHA-256 and
ordered chunk sizes/hashes. Only files actually present in the verified seal are
exported; absent memory exports are not inferred. Files are bounded to 1 GiB and
1024 chunks. Export checks regular-file identity, streamed length and the original
seal hash again while writing the bounded chunks, rejecting changed files.

The service checks descriptor identity, source report membership, declared binary
chunk sizes/hashes, original-file digest and filename collisions before publishing.
Portable backup/rebuild verifies and retains every binary part. Immutable report
records keep their existing encoding; adding a file does not collide with legacy
report metadata or create additional measurement captures.

`GET /api/v1/reports/{id}/files?revision=...` uses a report-owned persistent posting
set and returns at most eight descriptors. Global `/files` remains paginated.
`/files/{id}` reads selected metadata; `/files/{id}/chunks/{digest}` downloads
exact bounded original bytes with GET/HEAD. Chunk access requires selected file
and revision membership, never a bare content hash. Clients reconstruct an
original file in descriptor order and verify its full SHA-256. No bulk bytes are
part of ordinary result/report bootstrap data. Single-response bulk streaming
and report/tool archives remain separate open work.

Producer tests cover binary preservation, absent/unsealed files, changed seals
and symlink rejection. API tests cover multi-chunk byte reconstruction, scoped
file indexes, HEAD, forged chunk access and backup/rebuild. Wire tests reject
bad names, encoding, byte/count bounds and chunk/original digest drift. A fresh
installed producer verified an existing Wasmer call report, imported 117 objects,
and preserved six original Parquet files plus its timing/memory and twelve
analysis sections through HTTP. Schema/OpenAPI and generated consumer types
include the new resources.


### Explicit original-file streaming

`GET /api/v1/files/{id}/download?revision=...` now serves the full original
analytical file. HEAD validates availability and returns the same length, digest
ETag, media type and safe original filename; exact If-None-Match returns 304.
Ranges are rejected in this whole-file interface; selected chunk URLs continue
to provide bounded evidence access.

Before success headers, the store verifies all original chunk sizes/hashes and
the full-file digest. The stream retains one current chunk, rechecking content
when loading each next chunk. It does not assemble a full-file byte array. Late
corruption or write/cancellation failure aborts the HTTP connection, so the
original Content-Length cannot label a truncated body complete. Download context
and socket write deadlines are bounded to five minutes, with a separate two-slot
bulk budget under the existing request/peer admission and shutdown leases.

Tests check original bytes, filename/length/ETag, HEAD, 304, range rejection,
permit exhaustion/release, cancellation before further chunk reads, corrupt
chunks before success, and actual HTTP truncation after post-preflight corruption.
The existing multi-chunk backup/rebuild test exercises the new full download as
well. Verified Wasmer fixtures preserve all six original Parquet files through
both chunk and whole-file HTTP reads. Report/tool archives and broader bulk-scale
and slow-client operational gates remain pending.


### Parent archive source-admission prerequisite

Parent metadata reads now validate the index before opening a metadata path:
only `metadata.json`, a regular 256 KiB file, is admitted. The index is itself
bounded to 256 KiB and validates ordered original part names, hashes, integer
sizes, at most 2048 parts of 32 MiB, and the exact total. Opened file identity is
checked against lstat, symlinks/non-files are rejected, metadata reads detect
size changes, and archive verification streams at 1 MiB while checking each
part and the concatenated original digest. No archive extraction or execution
is introduced.

Completed-job API publication now checks parent session/plan/machine binding
and requires recorded metadata integrity before contacting the service. It
preserves the original index bytes/hash and does not rehash the full tools
archive for every corpus. The coordinator's existing full parent verification
remains responsible for that session-level check. Legacy static staging can
still read manifests without a metadata hash; API publication fails closed for
that uncommitted metadata case.

The staging path uses the same admitted metadata reader instead of reading an
unchecked index-provided path. A new regression suite covers unsafe paths,
symlinks, size bounds, plan/machine mismatches and changed archive bytes. The
existing publication, stop/resume and history suites pass (29 tests), including
wrong-machine rejection before an HTTP import. A current V8 local parent archive
verified its original two parts and 60,811,832 bytes with the new reader. CI now
includes the parent-bundle regression suite. This closes source-admission checks;
actual parent archive ingestion, availability descriptors and API downloads
remain open.


### Parent archive ingestion and shared content

Completed jobs now optionally carry a bounded `parentArchive` transport: original
index and metadata objects plus ordered 1 MiB archive chunks. Original archive
parts, their checksums and concatenated full digest remain authoritative. The
service verifies original index/session/machine/plan and metadata commitments,
all source part boundaries/digests and the full archive before publication. It
never extracts or executes the archive. Legacy jobs omit this field and remain
readable, without invented content availability.

These objects participate in existing upload permits, pending/content quotas,
missing-object pages, abort/recovery and portable backup/rebuild. Corpus jobs
share the same parent hashes and content; subsequent jobs request no existing
parent bytes. `parentArchiveStored: true` is a small published-job indication,
not a download or replay-availability claim. Ordinary progress pages do not
embed chunk inventories. Public parent metadata/chunk/download endpoints remain
open work.

The existing coordinator publisher materializes transport chunks from the existing
parent archive once, in a cache keyed by the original index digest. This is an
archive transport representation, not a second tool cache or collection backend.
Concurrent preparation uses unique atomic temporary files; warm publication
reuses the completed snapshot, preserves raw index/metadata bytes, and uploads
only missing content. Cancellation is checked during cold preparation. Archives
are currently bounded to 1 GiB/2048 transport chunks, within configured import
quotas; larger archive inventory/scale policy remains open.

Wire/store tests cover original parts crossing transport chunk boundaries,
reordered/corrupt bytes, scope mismatches, hidden partial publication, cross-corpus
content reuse, unchanged history and byte-complete backup/rebuild. Node tests
cover concurrent and warm materialization plus the existing publication/resume
workflow. A current 60,811,832-byte V8 parent archive imported and reverified as
58 chunks. That opt-in gate uses a synthetic measurement association and does
not claim a real completed-job collection binding. Archive serving, larger-scale
and crash coverage remain pending.


### Published parent archive resources

`/archives/{job}` now resolves only a job published in the selected dataset
revision. New publication maintains a direct immutable job-ID lookup alongside
session job postings; older immutable revisions use the original exact session
posting key for compatibility. Staging/import identifiers do not grant access.
Portable reconstruction validates both posting forms against the original job.

The small descriptor distinguishes imported content from legacy `not_imported`
identities, lists bytes/full digest and metadata references, and retains explicit
conditional replay and unchecked qualification explanations. It embeds no chunk
inventory. Selected `/index` and `/metadata` reads return the exact original JSON
bytes and hash ETags, including whitespace; values are not re-encoded.
`/chunks` uses revision/query-bound pagination, `/chunks/{digest}` restricts bytes
to the selected archive, and `/download` serves the exact original gzip archive
through the shared two-slot, five-minute preflight/stream verification budget.
No extraction, disassembly or archived tool execution occurs on API reads.

Tests cover hidden staging, frozen revision membership, missing legacy content,
small descriptors, paged chunks, forged byte access, byte-identical original
JSON, complete archive GET/HEAD, and backup/rebuild of the read surfaces. Existing
report-file corruption/cancellation tests exercise the shared stream implementation.
Schemas/OpenAPI/generated types cover archive descriptors and chunk pages.
Full race tests and vet pass; archive-specific schema capture and Linux cross-build
are checked locally. Larger archive/slow-client/crash and broader real collection
association gates remain open.


### Archive process exits and bounded large completed jobs

A new actual-subprocess archive gate exits at files, indexes, before-commit,
after-commit and after-portable checkpoints. Reopening admits archive reads only
after the durable commit. Before-commit cases then remove one original chunk;
commit remains hidden, resume requests that missing content, and restoring it
allows idempotent publication with exactly six retained measurement summaries.
Every recovered case streams a complete verified archive, backs up and rebuilds
without its DB, and preserves the original accepted-job receipt.

Completed-job manifests now have a separate 1 MiB decoded/durable limit, matching
the admin JSON request ceiling. The previous 256 KiB bound rejected legitimate
multi-export jobs. Only typed job reads/writes use the larger limit; evidence,
scientific records and radix/index objects retain their existing 256 KiB bound.
Session compatibility, published archive lookup, portable marking and DB-free
reconstruction use the same job-specific reader. Admission rejects oversize jobs
before quota changes.

An eight-export, 442,119-byte synthetic completed job published and survived
restart, backup and DB-free rebuild with all 24 summaries preserved. This proves
the bounded job container, not larger individual canonical measurement records.
The archive gate uses multi-chunk synthetic original bytes; large real archive
crash/slow-client/retention gates and production deployment remain open.


### Live slow-client cancellation and shutdown gate

A live HTTP/TCP test now holds two 64 MiB synthetic download streams open without
consuming their bodies. The shared bulk budget rejects a third before opening
its reader, while an unrelated read continues. Storage close waits for the
admitted stream leases. Canceling the server request context forces socket write
deadlines, unblocks both handlers, releases both bulk permits and completes
storage shutdown within the test deadline. Connections remain open during the
cancellation check, so passing does not depend on the client closing its socket.

This exercises the shared whole-file/parent-archive streaming implementation
through real sockets. The stream source is synthetic transport stress, not
benchmark evidence or a claim about measured throughput/RSS. Repeated race runs
include archive/report-file reads and corruption handling. Wider multi-client
scale, long-duration timeout and production proxy operation remain open gates.

## Locked session plan content and published coverage

The completed-job API sink now attaches the exact bytes used by the existing
coordinator's plan identity function: `JSON.stringify` after removing `id`,
`created` and `identity`. These bytes are stored in the shared content store as
1 MiB binary chunks, with a 16 MiB total ceiling. The service validates each
chunk, the original full plan hash, strict JSON, unique machine/corpus identities,
configured harness pin and the submitted job's membership. Unknown locked fields
remain in the source bytes; Go never re-encodes those bytes to compute identity.

The revision's persistent session-plan posting references a published canonical
job with this verified content. Publication verifies existing legacy deliveries
before first attaching a scope, and checks subsequent deliveries against it even
when they omit plan content. Plan references cannot point to staging or future
jobs. Content participates in missing-object admission, publisher quotas, pending
cleanup protection, portable closure and DB-free reconstruction.

For a revision with plan content, `plannedJobs` is the Cartesian product of the
plan's machines and corpus jobs. `collectionComplete` means every pair has at
least one **published completed attempt**, including failed or unsupported
outcomes. Retries count once. This describes published coverage, not scientific
success or an observed worker shutdown. Earlier immutable revisions without plan
content continue to return unknown completeness. The response records the reason.

Tests cover exact ordering/Unicode, source identity mismatch, duplicate identities,
unlocked fields, multi-chunk plans, missing content, legacy jobs outside scope,
retry counts, multiple members, frozen views, restart and backup/rebuild. Actual
process exits at five publication checkpoints exercise hidden plan indexes,
missing-chunk retry and portable recovery. The existing coordinator's resume and
failed-outcome tests still pass. Registering an empty session before its first
completed corpus and live worker/attempt state remain separate open requirements.

## Indexed session plan membership

New publications retain a small `session-plan-scope` record with source plan/pin,
published source job, member/corpus counts and persistent membership roots.
Ordinary session progress uses these pages instead of opening the source job or
assembling its potentially 16 MiB plan. Later corpus publications reuse the same
projection. Older revisions keep the source-plan fallback; their next publication
adds the projection without rewriting the old revision.

Startup, backup and DB-free reconstruction still require the original source
content. Portable verification derives membership from the hash-verified locked
plan and checks every projected name, value and count, as well as the source job's
publication in the requested revision. Membership pages join the existing typed
content closure and cleanup protection. A synthetic plan with 1,000 corpora,
2,000 planned member/corpus pairs and over 2 MiB of retained source options tests
bounded progress, source-read independence, missing-evidence backup rejection and
exact restart/rebuild. Altered membership and staged source references are
rejected. This proves read dependencies, not a serving throughput or RSS budget.

## Bounded plan proof reuse during recovery

One startup/backup/cleanup/rebuild validation pass may encounter the same locked
plan through its projection, legacy reference and many completed jobs. The typed
closure now reuses a verified scope within that pass, keyed by the full plan hash,
configured harness pin and exact ordered transport descriptors. Every job still
checks machine/corpus membership. Changing a pin, full identity or chunk ordering
cannot reuse the proof.

The cache retains at most two scopes under a conservative 4 MiB name/map/slice
accounting budget. It stores no raw plan bytes, declines oversized scopes and
re-verifies after eviction. Returned name slices are independent copies. Each
new validation pass starts empty, so earlier success cannot conceal subsequently
missing evidence. Original chunks remain in the marked portable content closure.
Tests prove one source read across 100 reused jobs, per-job membership rejection,
exact identity isolation, eviction, oversized-scope admission without retention,
and missing-source rejection in a fresh pass. Existing large-plan, membership
projection, crash and portable recovery tests pass. These checks do not establish
throughput, physical RSS or wider retention-scale budgets.

## Parent archive proof reuse during recovery

The typed startup/backup/cleanup/rebuild closure now keeps at most 128 fixed-size
parent archive verification receipts within one pass, under conservative 32 KiB
accounting. Keys include the session, machine, locked plan, configured harness
pin, parent index hash and exact ordered transport descriptor. Different bindings
cannot reuse a receipt; changed configured pins require another byte verification
without claiming the archive independently establishes that pin.

Receipts retain no archive bytes or descriptor arrays and do not survive the pass.
Eviction clears old keys and requires verification again. Original index,
metadata and binary chunks stay in the marked portable content closure. Import
publication and HTTP downloads continue their existing independent verification.

Race checks cover reuse across 100 corpus-job associations, source/transport
mismatches, fresh-pass missing and corrupt content, repeated receipt eviction,
parent admission/recovery and actual archive/session-plan crash checkpoints. The
retained V8 parent also verifies 60,811,832 original bytes through 60 source reads;
100 reused synthetic associations make no further archive reads, and a fresh pass
rejects a simulated missing chunk. This is real-byte verification evidence with
synthetic job associations, not a new measurement, throughput claim or qualification.
Larger retention, serving load and deployment timeout gates remain open.

## Recovery enforces registered scope for legacy deliveries

A DB-free rebuild regression exposed a missing admission check: a hash-consistent
portable revision could include a completed job without plan content whose
machine or corpus lay outside its registered session plan. Rebuild accepted it,
although completed-job publication rejects that delivery.

Typed closure validation now checks every revision's canonical job against the
plan available in that exact revision, including jobs that omit plan content.
Plan and configured-pin bindings must also match. Indexed scopes use membership
pages; older plan-reference formats share the bounded per-pass plan verifier.
Revisions without any registered plan keep their existing unknown-scope behavior.

The executable regression constructs content-complete portable chains with valid
hashes and unchanged measurement exports, then alters machine, corpus, plan or pin.
Both current indexed and older plan-reference formats must reject the actual
`Rebuild` operation before a destination is installed. Existing valid frozen,
legacy, large-plan, crash and portable-recovery checks remain in place. This fixes
recovery/publication parity without changing measurement or comparison policies.

## Job references prove publication and frozen ancestry

A portable rebuild regression showed that a hash-consistent public job posting
could reference fully uploaded staging content without any canonical publishing
revision. Another regression shared a newer posting tree with an older revision;
a generic shared-node validation memo could skip the older view's ancestry check.

Typed closure validation now derives unique job publication origins from the
active immutable revision chain. Public session/direct-job postings must name
one of those jobs, retain its actual publication timestamp and belong to the
requested revision or an ancestor. Uploaded content and a matching source job
summary alone do not establish publication. Duplicate canonical job publications
and unreachable registered revisions are rejected.

Shared posting nodes and their directory retain a cached newest-origin bound.
That bound is compared for every revision, even when structural/content validation
was already performed in a newer view. This avoids scanning every historical job
again for each revision. Radix depth and cycles are checked, including paths that
reach already cached subtrees.

Actual DB-free rebuild tests reject staging-only postings, future jobs in a shared
frozen tree and invented publication times before installing a destination.
Existing membership-drift tests now assert their specific rejection, preserving
their coverage rather than passing on an unrelated ancestry error. Scientific
exports, numerical values, collector policies and the frontend remain unchanged.
