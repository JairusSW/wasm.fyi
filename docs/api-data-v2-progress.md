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
- Objects have full SHA-256 names, at most 256 KiB decoded; root inventories have at most 512 objects, and an import accepts at most eight report exports. Oversized records fail explicitly. Artifact descriptors are at most 10 KiB decoded. A large corpus must be split before this experimental exporter can handle it.
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

The producer records its actual executable SHA-256 separately from the collecting
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
