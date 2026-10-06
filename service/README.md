# wasm.fyi API service

Experimental Go/Pebble/local-content service for the existing collector. See the
[implementation checkpoint](../docs/api-data-v2-progress.md) for commands,
wire contracts, validation and remaining production gates.

Run the built executable lifecycle smoke test from the site root:

```sh
(cd service && GOFLAGS=-mod=readonly GOWORK=off go build -o /tmp/wasmfyi-smoke ./cmd/wasmfyi)
python3 scripts/api-service-smoke.py --binary /tmp/wasmfyi-smoke
```

The standard-library Python runner creates temporary stores, publishes the
synthetic producer fixture over HTTP, repeats the commit, shuts down gracefully,
restarts, verifies a backup, then serves both its restored and DB-free rebuilt
copies. It checks frozen result/session/history values and the original signed
pagination cursor in each copy. It deletes its temporary data on exit. CI runs
this against the native Linux binary in addition to the Go tests.

Local execution passed on macOS arm64 and Linux aarch64. The Linux run used a
non-root, network-disabled container with one CPU, 512 MiB memory, a read-only
root filesystem and temporary data on tmpfs. This establishes executable/API
compatibility; it does not test durable storage across machine failure, off-machine
restore, production proxy behavior or scientific qualification.

Wire decoding rejects malformed UTF-8 and unpaired UTF-16 escapes instead of
silently replacing source text. Duplicate keys, unknown typed fields and trailing
documents remain rejected. Numeric token validation preserves original JSON
number spelling, including values held as raw producer evidence. Public errors
expose stable messages and codes; wrapped filesystem details stay internal.

Run bounded ingress fuzz checks from `service/` with:

```sh
go test ./internal/wire -run '^$' -fuzz '^FuzzDecodeTransport$' -fuzztime=20s -parallel=2
go test ./internal/api -run '^$' -fuzz '^FuzzQueryAndCursor$' -fuzztime=20s -parallel=2
go test ./internal/store -run '^$' -fuzz '^FuzzImportLifecycle$' -fuzztime=50x -parallel=2
```

These cover transport validation, query normalization, signed cursors, byte-range
parsing and encoding negotiation. They complement the stateful import/recovery
tests; they do not establish unlimited load capacity or exhaustive fuzz coverage.

The lifecycle target uses real Pebble/CAS stores and an independent model for
two imports with shared objects. It checks staged/published/aborted state, missing
objects, quota release, immutable plan conflicts, corrupt uploads, duplicate
publication, restart and consistent backups after each operation. Runs are capped
at 24 operations per input and two backups, so this slower target uses a fixed
execution count. HTTP tests separately check that rejected ingress does not read
the request body or publish data.

The serving module imports no harness code and no SQLite. It does not execute
benchmarks, archived verifiers or on-demand native disassembly. The current
frontend is still served through the existing Pages workflow.

Behind a reverse proxy, `serve --trusted-proxies 127.0.0.1/32,::1/128` optionally
uses one `X-Real-IP` address for public client rate budgets. List only actual proxy
transport networks. The proxy must overwrite that header with the connecting
client address and prevent clients from bypassing the proxy through a trusted
origin path. Missing, duplicate, chained, port-bearing, zoned or invalid addresses
from a trusted proxy are rejected before body reads. IPv4-mapped addresses share
the same budget as their IPv4 spelling. Other forwarding headers are ignored.

Without this flag, all forwarding headers remain ignored. Untrusted transport
peers always use their own address. Authenticated publication stays on transport
budgets, preserving publisher capacity independently of end-user addresses.
Health/readiness probes also use transport budgets and require no client header.
Trust configuration is copied at startup, capped at 64 CIDRs and rejects universal
or mapped-address prefixes. This flag changes rate identity, not authentication,
TLS requirements, revision scope or storage permissions.

Executable wire-contract checks use a pinned test-only JSON Schema validator:

```sh
uv run scripts/check-api-contracts.py --export service/testdata/site-v2
(cd service && WASMFYI_CONTRACT_OUTPUT=/tmp/new-api-contracts.jsonl go test ./internal/api -run 'TestOverviewComplete|TestResultSummaries|TestNativeFunctionAPI' -count=1)
uv run scripts/check-api-contracts.py --responses /tmp/new-api-contracts.jsonl
```

Run these commands from the site root.
Use a new capture path; successful JSON GET responses append to that file.
Export checks verify payload hashes/sizes, inventories, detailed results, derived
analysis resources and function rows. Response checks resolve local OpenAPI/JSON
Schema references without fetching remote schemas. Negative tests cover missing
provenance, invalid dates, recipe preloading and invalid function ranges. The
existing API CI workflow runs this gate and generated-type checks. These checks
complement producer verification and Go validation rather than establish scientific
derivation or full coverage of all endpoint schemas.

To host a fixed root-path SvelteKit build alongside the API, pass
`--frontend /absolute/path/to/build` to `wasmfyi serve`. The directory must contain
the adapter-static application shell `404.html`; missing or symlinked shells fail
startup. Known application routes use that shell rather than prerendered HTML.
Measured `/bench/...` workload routes resolve through the current revision's
index; missing workloads and assets return real 404s. Immutable `_app` assets
receive long-lived caching; navigation and other assets revalidate. Static reads
share the service's request limits and shutdown leases.

This flag supplies backend hosting, not the frontend data migration. The current
client still uses its bundled snapshot, so production cutover must wait for lazy
API-backed rendering and crawler/reference-page validation. Builds with a nonempty
`BASE_PATH` require matching proxy routing and are not handled by this root-path
host. Treat the build directory as immutable while the process is running.

`GET /api/v1/aggregates?scope=<URL-encoded JSON>` computes the whole selected
cohort and returns a small summary. The `CohortScope` contract is in
`schemas/site-v2.schema.json`. Scope policies explicitly select the environment,
current/previous measurements, tracks or exact configurations, producer method
and metric-definition digests, analysis version, weighting, workload population,
contract policy, mixed builds and recorded/missing collector handling.

The returned `cohort` identity is used at `GET /api/v1/cohorts/{id}` with optional
`limit`, `cursor` and `lane`. It freezes the revision, is signed with the durable
cursor key and reconstructs from stored summaries after cache loss or rebuild.
Membership pages contain exact result/report/configuration/contract/method
references and source values. Aggregates do not load trial evidence or invent
cross-report confidence intervals. Scope JSON is limited to 4 KiB; calculations
are bounded and admitted separately from ordinary API requests.

`GET /api/v1/overview?scope=<URL-encoded JSON>` uses the same explicit cohort
scope and returns small cards, unit/definition references, population counts and
policy explanations. It computes the complete selected population, shares the
bounded cohort cache and calculation admission, and links to paginated membership.
Each response resolves one revision; explicitly pinned scopes are immutable.
Trial evidence, recipes and report inventories are absent. Publication integrity,
producer source assertions and operator qualification remain separate fields.
No baseline or compatible method is selected implicitly. Popular overview presets
and publication-time precomputation remain pending.

Result and history pages omit full method recipes and evidence inventories while
retaining `measurementMethodId`, exact source summary values and provenance IDs.
Resolve one descriptor at `/api/v1/methods/{id}?definition={metricDefinitionId}`
within the same revision; `/results/{id}` still returns the canonical detail.
These summary representations are distinct from import records. Pagination
serializes only returned rows after global selection/sorting. Immutable sorted
summary selections share a fixed 16 MiB/24-entry cache across page sizes, with
conservative memory charging; oversized selections are served without retention.
Two uncached selections may execute concurrently. Cache keys include the exact
revision, normalized filters, selection, sort and history window.

`GET /api/v1/sessions/{id}?revision=...` reports the session's immutable plan/pin
bindings and counts of jobs published in that revision. `/sessions/{id}/jobs`
returns bounded pages of completed collection jobs, with small report and parent
bundle references. Cursors freeze publication state. The service currently
receives completed jobs; it does not have the full planned job inventory or live
worker states. Therefore planned-job count and full-session completeness are
explicitly null. Upload/abort details remain on authenticated admin endpoints.

`/api/v1/history` accepts `from` and `until` RFC3339 instants together. The window
is inclusive at `from` and exclusive at `until`, and spans at most 120 UTC month
buckets. Equivalent timezone representations normalize to the same cursor scope.
Published month indexes let a selected window skip older linked history objects;
older dataset revisions remain readable through a bounded fallback. Historical
evidence enrichment still resolves to the same capture.

Fresh producer report descriptors include `analysisSectionVersion: source-fields-v1`
and `analysisSections`, a bounded map from original derived source field names to
evidence references. Throughput, scaling, counter displays, CPU stacks, timelines
and future derived JSON fields retain producer values. Resolve selected roots or
fragments through `/reports/{id}/evidence?chunk=...` in the pinned revision.
Large sections use the existing independently readable JSON-resource transport.
Import and portable recovery check report/field identities and retain the entire
content closure. Legacy report descriptors remain readable. External analytical
files and archive downloads require separate resources.

`GET /api/v1/artifacts/{id}/functions?revision=...&limit=...` returns bounded
function attribution in producer order, with totals, completeness and a signed
next cursor. Fresh native metadata records `producer-order-v1` shard counts,
validated against actual rows at import and recovery, so pages skip unselected
shards. Legacy exports use a bounded counting fallback. Cursors bind the artifact,
revision and page limit; no native bytes or disassembly are fetched by this route.
Unavailable attribution returns 404. Metadata supports at most 4,096 shards and
one million functions; requests retain the existing work, response and decoded
byte ceilings. Original inspection chunks remain accessible independently.

For maintenance while serving, create a private directory (mode `0700`) and pass
`--control-socket /private/run/wasmfyi.sock` to `serve`. The optional local Unix
socket has mode `0600`; existing socket paths are rejected. Use
`wasmfyi backup --control /private/run/wasmfyi.sock --output /private/new-backup`
or `wasmfyi gc --control /private/run/wasmfyi.sock` (add `--apply` for cleanup).
These commands use the live database owner; they never open a second Pebble
instance. Network publisher credentials cannot call these operations. Maintenance
admits one request at a time, shares publication serialization and holds a shutdown
lease. Cleanup retains its 24-hour/7-day grace periods. Backup output must be a new
destination; relative CLI paths resolve on the caller before transmission.
Shutdown cancels requests and removes the owned socket. After an abrupt process
exit, operators must check that the old owner is gone before removing its stale
socket. Verify backups and exercise restore/rebuild before relying on them.

Large trial inventories use `evidence-index` schema 1 objects with one to 128
ordered `references`. A result points to the root index; clients fetch an index
page and then only the selected trial/sample chunks through the existing
`results/{id}/samples?chunk=...` endpoint. Lists of at most 128 references retain
the legacy representation. Repeated references and producer order are preserved.
Indexes carry provenance navigation, not additional measurements or statistical
samples. Every child still needs to be declared, hash-verified and reachable from
the selected result in the requested revision.

Authorization traverses evidence breadth first so a large sibling trial body does
not prevent reaching a navigation page. The existing work and 32 MiB decoded-scan
ceilings still apply; an unknown or excessively deep/broad lookup can be rejected.
Publication and portable rebuild retain and validate the complete indexed closure.
The retained producer test uses 4,500 synthetic trials; the HTTP/recovery test uses
512 synthetic 100 KB trial bodies. These are storage/transport scale fixtures.

Run the existing coordinator's completed-job publisher against the built service:

```sh
node --test scripts/api-large-publication.test.mjs
```

This gate creates 4,500 synthetic trial references, interrupts a staged upload,
resumes using missing-object admission, and verifies that installed objects are
not uploaded again. It checks frozen values and selected first/last trial reads
after restart and DB-free rebuild. Set `WASMFYI_LARGE_TRIAL_FIXTURE` to a producer
export directory to exercise those exact bytes, and `WASMFYI_SERVICE_BINARY` to
an existing native binary instead of building one. The supplied large producer
fixture remains synthetic and carries no operator qualification claim.

Publisher cancellation now stops local export validation as well as network
requests. HTTP 429 responses use the API's integer `Retry-After` (1–30 seconds);
all retries and waits share the request's original 30-second deadline. Cancellation
also stops backoff. Other HTTP failures remain explicit so an operator can resume
the immutable attempt after addressing the cause.

The collector also passes its stop signal into parent-bundle verification.
Metadata readers check cancellation and close opened files; archive streams use
that signal and close their file handles on exit. API parent materialization
checks cancellation during cache reads, chunk writes and descriptor installation.
A canceled write removes only its own temporary file. Completed chunks remain
available for retry, and a descriptor is installed only after full archive
verification. An abort concurrent with the final atomic rename may leave a valid
complete cache descriptor; it cannot install a partial descriptor or publish a
website revision. Real stream/write cancellation and subsequent retries are
checked on macOS and Linux by the parent-bundle tests.

Parent transport cache entries now verify the index/metadata objects, each chunk
hash and the concatenated original archive digest. Missing or damaged cache files
are rebuilt from the original archive and checked again; damaged content without
its source fails explicitly. Reordered internal cache JSON preserves the canonical
transport encoding used for completed-job identity.

A process-local receipt cache retains at most eight entries and 2 MiB of accounted
metadata. Every reuse checks file identity, size, mode and nanosecond modification
and change times. Changed files and evicted receipts require fresh byte checks.
Reads allocate at most one 1 MiB chunk plus a sentinel; descriptor reads are also
bounded and checked through an opened file handle. These receipts attest cache
integrity and do not replace source verification or operator qualification.

The optional archived-byte gate uses read-only source files and temporary caches:

```sh
WASMFYI_REAL_PARENT_BUNDLE=/path/to/session/bundle node --test scripts/api-parent-archive.test.mjs
```

It verifies the archived parent, checks 100 warm calls without rereading chunk
bodies, corrupts a temporary cached tail, and verifies exact repair. It runs no
benchmark or archived executable. The 60,811,832-byte V8 parent passed this gate
on macOS and native Linux aarch64; durable disk and off-machine restore remain
separate gates.

Website comparison analysis is now `wasmfyi-cohort-v2`. The `latest-in-scope`
contract policy finds the latest capture only within the requested lanes and
workload population. Unrequested runtimes cannot supersede selected contracts;
excluded feature probes cannot introduce timestamp ambiguity. Conflicting exact
contracts at the latest timestamp within the selected population still fail
explicitly. The `all-exact-contracts` policy remains available.

The overview exposes `interpretation.contractSelection` from the requested policy.
Cohort digests, cache keys and signed tokens bind the comparison version. Existing
v1 cohort tokens are rejected; resolve the selected overview/aggregate again to
obtain a v2 token. Result/history records, producer analysis versions, scientific
values, unavailable uncertainty, and the `s1`/`s2` selection aliases are preserved.
This fixes comparison membership; it does not qualify the wider cohort/history
methodology or complete production cutover.

Aggregate summary responses now have the executable `AggregateSummary` contract:
at most 32 lane populations, versioned comparison policy, reference counts, and
explicitly null member/report inventories. Complete cohort membership remains a
paged subresource. Schema checks reject evidence preloads and manufactured
uncertainty; generated TypeScript types share the contract. Comparison v2 HTTP
captures cover overview, aggregate summaries and member pages.

Pin analysis in overview/aggregate URLs with `version=wasmfyi-cohort-v2` as well
as an explicit `scope.revision` for immutable caching. Without the version,
responses use `no-cache` and revalidate so a policy upgrade cannot leave a stale
cohort token in a long-lived browser cache. Unsupported versions fail explicitly.
Signed cohort member URLs already bind the analysis version and remain immutable.
