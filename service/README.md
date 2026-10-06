# wasm.fyi API service

Experimental Go/Pebble/local-content service for the existing collector. See the
[implementation checkpoint](../docs/api-data-v2-progress.md) for commands,
wire contracts, validation and remaining production gates.

API collection requires a producer whose prepared controller supports
`wasmbench export-site --describe`. Preparation checks its versioned format,
source-verification policy and object/inventory ceilings before building adapters
or running workers. Cached tool reuse probes the hash-verified controller again.
Legacy file publication does not require this contract. The configured harness
pin is retained separately from the actual producer revision and export identity;
this check does not publish or update either pin.

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

To retain a private portable bundle for another machine, add `--export`:

```sh
python3 scripts/api-service-smoke.py --binary /tmp/wasmfyi-smoke --export /tmp/wasmfyi-portable-smoke
python3 scripts/api-service-smoke.py --binary /tmp/wasmfyi-smoke --recover /tmp/wasmfyi-portable-smoke
```

Recovery requires only the exported bundle, not the producer fixture. Preserve
private file modes when transferring it. On macOS, use `tar --no-mac-metadata
--no-xattrs` when creating a transfer archive: added Apple metadata files are
correctly rejected by strict backup verification.

Local execution passed on macOS arm64, Linux aarch64 and native Linux x86_64.
The aarch64 run used a non-root, network-disabled container with one CPU, 512 MiB
memory, a read-only root filesystem and temporary data on tmpfs. The x86_64 run
used a separate host, one CPU and ordinary filesystem-backed temporary stores.
Off-machine restore and DB-free rebuild passed in both macOS arm64 → Linux
x86_64 and Linux x86_64 → macOS arm64 directions, preserving frozen values and
signed cursors without importing the source fixture. These are synthetic-fixture
checks; physical machine-failure durability, large real-evidence recovery,
production proxy behavior and scientific qualification remain unproven. The
updated CI workflow has not yet been run.

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
No baseline or compatible method is selected implicitly. Authenticated overview
presets prepare bounded projections before publication; registration and recovery
are described below.

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

Website comparison analysis is now `wasmfyi-cohort-v4`. The `latest-in-scope`
contract policy finds the latest capture only within the requested lanes and
workload population. Unrequested runtimes cannot supersede selected contracts;
excluded feature probes cannot introduce timestamp ambiguity. Conflicting exact
contracts at the latest timestamp within the selected population still fail
explicitly. The `all-exact-contracts` policy remains available.

Comparison v4 requires recorded observation scope, unit and definition version
to match the selected metric, and observation profile to match its source method.
Current RSS additionally requires process scope, an `after_batch` boundary,
`boundary_snapshot_only` quality and a `process` denominator. Contradictory
producer claims remain available in raw records but cannot form a cohort. Timing
and memory source passes remain distinct and may both contribute explicitly
selected current-RSS boundary cells. No collector implementation is inferred.

The overview exposes `interpretation.contractSelection` from the requested policy.
Cohort digests, cache keys and signed tokens bind the comparison version. Existing
v1/v2/v3 cohort tokens are rejected; resolve the selected overview/aggregate again
to obtain a v4 token. Registered older-version presets remain listed and portable,
but must be explicitly re-registered with v4 to prepare future publications.
Result/history records, producer analysis versions, scientific values, unavailable
uncertainty, and the `s1`/`s2` selection aliases are preserved.
This fixes comparison membership; it does not qualify the wider cohort/history
methodology or complete production cutover.

Aggregate summary responses now have the executable `AggregateSummary` contract:
at most 32 lane populations, versioned comparison policy, reference counts, and
explicitly null member/report inventories. Complete cohort membership remains a
paged subresource. Schema checks reject evidence preloads and manufactured
uncertainty; generated TypeScript types share the contract. Comparison v4 HTTP
captures cover overview, aggregate summaries and member pages.

Pin analysis in overview/aggregate URLs with `version=wasmfyi-cohort-v4` as well
as an explicit `scope.revision` for immutable caching. Without the version,
responses use `no-cache` and revalidate so a policy upgrade cannot leave a stale
cohort token in a long-lived browser cache. Unsupported versions fail explicitly.
Signed cohort member URLs already bind the analysis version and remain immutable.

Cohort response v4 exposes `approximateInputs` for each population/card: the number
of contributing source values that lost precision when converted for calculation.
`ratioUsesApproximateInputs` includes conversion loss in either the numerator or
baseline and is null when the ratio is unavailable. Failed/excluded cells do not
contribute to these counts. `comparison.valueRepresentation` is `float64`, and
overviews share the numeric interpretation. Exact originals remain in paged
membership, including decimal strings beyond JavaScript's safe integer range.

These flags describe input conversion, not confidence intervals or the rounding
of every subsequent arithmetic operation. A zero count does not certify an exact
floating-point aggregate. The v3 response version prevents immutable v2 URLs or
tokens from silently serving a projection without the new required precision
fields. Measurement identities, weighting, arithmetic and uncertainty policies
remain unchanged.

Revision discovery (`/api/v1/revisions`) now reads only the requested parent-chain
page, newest first. The signed cursor carries the starting revision, page size,
next revision and logical offset. Publishing newer jobs does not change the
cursor's total or chain; restart and portable rebuild preserve its position.
Counts come from derived chain positions maintained in the already validated
revision registry. These positions never enter persisted JSON or revision hashes.

The endpoint returns one to 1,000 revision IDs per page and a typed `RevisionPage`
contract. Old offset-only revision cursors fail explicitly; begin at the first
page to obtain a new successor cursor. Other endpoint cursors are unchanged.
The retained synthetic gate crosses the former global scan ceiling and verifies
that an ancestor outside the requested page is not read. This establishes bounded
query work, not qualification of 100,000 real publications or startup/restore
scale. Wider retention and physical storage gates remain open.

Session-plan registration preparation now has its own `PlanRegistration` wire
contract (schema 1): session name, exact locked-plan digest, configured harness
pin and at most sixteen 1 MiB chunk descriptors. `prepareSessionPlan` in the
existing publisher prepares that scope without a completed attempt or export;
completed-job publication uses the same preparation. Go verifies those exact
bytes independently of job membership, while completed-job verification still
requires membership. Verification accepts a cancellation context through reads
and scope validation. Durable registration is available through authenticated `POST /admin/v1/plans`,
`GET /admin/v1/plans/{id}/missing`, and `POST /admin/v1/plans/{id}/commit`.
Chunks use the existing declared-object upload endpoint. An abort endpoint
releases staging quota and permits. Plan registrations and measurement imports
share the pending admission quota; the committed registration registry is bounded
to 4,096 sessions. `pendingJobs` in admin metrics counts all pending admission
units, including plan registrations.

The existing coordinator registers the full immutable plan before preparing
workers on both run and resume. Duplicate registration uploads only missing
chunks and returns the same ID. Registration does not create a measurement
revision. `GET /api/v1/collection/sessions/{id}` returns a small registered scope
with planned machine/corpus count and source identities; it rejects revision,
cursor and pagination queries. This live surface is separate from frozen
published-job progress. The separate attempt-progress endpoints and coordinator
delivery journal are described below; they do not constitute measurement evidence.

Registration uses synchronous Pebble publication plus the durable portable
pointer. Its persistent membership maps and original plan chunks participate in
backup, verification, cleanup and DB-free reconstruction. Restart reconciles a
DB commit interrupted before pointer sync; unacknowledged state stays hidden in
the running process. Tests cover registration before any measurement, missing
source admission, cancellation/abort, shared quota migration, two publication
fault checkpoints, restart, backup restore and DB-free rebuild. They do not yet
prove physical crash durability or large multi-session operational load.

Attempt progress is an authenticated operational assertion, separate from sealed
measurements and publication. `POST /admin/v1/progress` accepts schema 1, session,
locked-plan digest, machine, corpus, attempt ID, sequence, status, optional phase
and producer observation time. States are `running`, `completed`, `interrupted`
and `failed`. The server records receipt time separately. A completed progress
record does not establish that evidence is verified or published.

The first sequence is 1; each subsequent update increments by exactly one. Exact
retries return the original receipt. Sequence gaps, conflicting redelivery and
updates after a terminal state return 409. A new attempt gets a distinct ID;
prior attempts retain their latest states. Each registered session admits at
most 10,000 attempt records, each with at most 10,000 sequential updates. The
store retains the latest state per attempt, not every phase event.

`GET /api/v1/collection/sessions/{id}/attempts/{machine}/{corpus}/{attempt}`
returns exactly one small live record. It accepts no revision or pagination
query and carries no evidence inventory. The persistent progress map participates
in registration publication, cleanup, backup and DB-free rebuild. Ordering,
idempotence, scope admission, terminal transitions, two publication fault
checkpoints, portable reconstruction and concurrent update/read/cleanup have
regression coverage. Live reads share the maintenance lock with cancellation,
so cleanup cannot remove a replaced index while a request follows it.

`publishAttemptProgress` uses the existing bounded publisher transport, deadlines
and rate-limit backoff. The coordinator now journals small progress updates before sending them. Each
host has a private `api-progress` directory in its local session member. Files
are installed with file and directory sync, are limited to 2 KiB, and retain
exact update bytes across retry. The journal permits at most 100,000 events and
10,000 attempts; its delivery queue permits at most 128 pending updates. No
trial arrays, result details or error-log text enter the journal.

Resume asks the API for each attempt's current state, checks it against the
journal and sends only subsequent sequences. This also repairs API state rolled
back by a restore. Lost replies do not invent new attempts. After stopping prior
workers, the coordinator replays saved updates and marks remaining running
attempts interrupted at the `coordinator-restart` phase before launching new
work. This closes an interrupted observation stream; saved sealed results still
determine measurement completion and publication. Cached completed results and
duplicate terminal worker/host events do not become new operational attempts.

Delivery failure or queue overflow stops collection while retaining the source
updates for resume. Cancellation leaves terminal events journaled for the next
resume instead of delaying stop for network retries. Progress delivery uses the
existing publisher deadlines/backoff, and all delivery promises are joined before
coordinator completion. Unit and actual-HTTP tests cover replay, lost replies,
rollback, interruption, overflow, duplicate terminal events and scope conflicts.
These tests run no benchmarks. Bounded attempt discovery is now available. Broader live remote-worker
operational qualification remains pending.

Attempt discovery uses `GET /api/v1/collection/sessions/{id}/attempts` with optional
`machine`, `corpus`, `status`, `limit` and `cursor`. The default page contains at
most 50 records; the maximum is 100. Filtering and global machine/corpus/attempt
sorting precede pagination. `total` counts the complete filtered scope, while
`complete` means the last page of that scope, not collection completion.

A signed cursor binds the progress root, session, normalized filters and limit.
An update changes the live generation; continuing its earlier cursor returns
409 `progress_changed`, requiring a fresh first page. Unknown pages do not
imply missing measurements. These operational pages accept no dataset revision
and do not hold permanent Pebble snapshots. Reads serialize with updates and
cleanup and honor cancellation. Status filtering scans at most 10,000 records
with a 32 MiB decoded scan budget; responses never contain evidence inventories.

The retained process-interruption gate runs with synthetic inputs:

```sh
node --test scripts/api-progress-process.test.mjs
```

It builds and starts the real service, registers a plan, and launches a separate
sender using the collector's progress journal and HTTP transport. The test sends
SIGKILL after the API commit and before delivery returns, restarts the service,
and resumes from the same journal. It verifies one interrupted original attempt,
one distinct completed resumed attempt and no manufactured measurement revision.
This proves that process boundary with local filesystem-backed temporary data;
SSH worker behavior, physical power-loss durability and scientific qualification
remain separate gates. The test is included in CI, whose execution is not claimed
by local validation.

Authenticated `POST /admin/v1/overviews` accepts a comparison `scope` and
`version: "wasmfyi-cohort-v4"`. It resolves an immutable revision and computes
the complete cohort with the existing comparison implementation, then stores
the compact projection through synchronous commit and a durable pointer.
Preparation does not change the measurement revision. The registry retains at
most 4,096 distinct versioned scopes.

Ordinary overview reads prefer prepared projections, avoiding complete result
scans and cohort computation slots. Signed cohort tokens are supplied at read
time; tokens and secrets are not materialized. Detailed membership remains on
the existing progressive endpoint. Prepared views are revision/analysis/category
bound and participate in cleanup, backup and DB-free reconstruction. Tests cover
byte-for-byte HTTP parity, computation admission bypass, restore/rebuild and two
publication-fault checkpoints. Automatic preset preparation is described below.

Authenticated `POST /admin/v1/overview-presets` accepts `name`, comparison
`version` and `scope`. Registration prepares the seed revision and stores a
normalized template without a dataset revision. Up to eight presets may be
active. The seed revision preserves the configuration's source identity.
`GET /admin/v1/overview-presets` lists the bounded inventory, and
`DELETE /admin/v1/overview-presets/{name}` disables automatic preparation while
preserving existing projections. Re-registering a name replaces its template.

Each completed-job publication prepares active current-version presets against
the unpublished candidate revision. Their compact projections and the new
measurement pointer commit in one synchronous batch, followed by the durable
portable pointer and reader visibility. A preparation failure leaves the
candidate revision hidden and retryable. Templates with an older analysis
version are retained but not reinterpreted. Presets preserve exact environment,
lane and method policies; operators update them explicitly when those identities
change. Tests cover automatic preparation, parity, failure/retry, preset removal
and DB-free reconstruction followed by a further publication.

Automatic preparation evicts replaceable projection references when its 4,096
entry registry fills. Eviction preserves preset templates and projections already
prepared for the candidate revision, and never removes measurements or evidence.
An evicted historical overview uses the existing complete-scope computation
fallback, preserving its immutable numerical meaning. The eviction path rebuilds
only bounded key/reference metadata, not historical result datasets.

`GET /api/v1/history/changes` compares two explicit JSON `before` and `after`
CohortScope parameters with `version=wasmfyi-cohort-v4`. Both scopes must pin
a dataset revision and one identical runtime track, environment, metric/method
selectors and population policy. The service intersects exact contract cells and
recalculates the existing geometric or RSS arithmetic policy over that population.
The response includes before/after values, after/before ratio, matched workload
and cell counts, unmatched counts, reused-evidence counts and approximate-input
counts. It does not infer paired uncertainty or preload membership/evidence.
Reused cells remain identified rather than counted as new observations. To inspect
membership, use the two existing aggregate/cohort scopes. Comparisons are immutable
at the pinned analysis version. This endpoint compares measurement selections;
source-date/release-role history associations remain a separate unfinished gate.

Completed-job manifests may include up to 256 optional `history` bindings with
`policy=declared-build-history-v1`. Each binding identifies an exported report and
exact configuration with measured results. Target calendar date, source timestamp,
source revision and build role (`source`, `release`, `unknown`) remain separate.
A `release` role requires explicit version, HTTPS source URL and publication time;
a source snapshot receives no release association by inference. These interpretation
fields are trusted publisher assertions, separate from source verification.
They never modify result timestamps or create independent observations.

The coordinator publication helper accepts explicit `historyBindings`; normal
collection omits them. Historical collection callers must supply qualified bindings
from their existing pin/receipt policy. Changing bindings on a previously delivered
attempt is rejected by immutable job identity rather than rewriting history.
Existing retrospective capture/alias projection still needs migration integration.

`GET /api/v1/history/jobs/{id}?revision=...&limit=100` pages these bindings from
the selected published job index, with signed revision/job/page-size cursors.
Staged jobs cannot expose history labels. Session job summaries advertise only
the binding count. The response reports actual job publication time and nullable
`collectedAt` from the source report's `created` field, with
`collectionTimeSource=source-report-created`. This report-level timestamp is not
a per-pass observation time; individual producer sampling groups retain their
original `capturedAt`. No missing date is substituted with a target or release date.
Bindings and their time/trust roles survive backup, restart and database-free rebuild.

Verified producer exports now include `report.tar.gz` as an explicit report-file
resource alongside sealed Parquet files. `packingVersion=sealed-files-tar-gzip-v1`
identifies an offline archive derivative: sorted sealed files, fixed tar ownership/
permissions/timestamps and gzip level 1, with the exact original `checksums.json`.
The archive preserves original file bytes, including any builder bytes already
sealed in the report. It does not imply hermetic replay or replace the session's
shared parent tool archive. `sourceSealSha256` must match the exported report.

The producer rechecks each original file while streaming into 1 MiB CAS chunks,
rejects links/escaping paths and limits archive input to 100,000 sealed files,
16 MiB of seal metadata, 8 GiB raw input and 1 GiB compressed output. The API
never unpacks or executes archive content. Existing selected chunks and explicit
whole-file GET/HEAD downloads retain preflight integrity, two-slot admission,
write deadlines and cancellation. A selected report contains at most nine file
descriptors. Legacy exports without archive bytes remain readable.

Authenticated `/admin/v1/metrics` adds `requests` telemetry alongside existing
storage/compaction fields. `http-requests-v1` uses ten fixed route classes and
retains no request URLs, queries, client addresses, credentials or dataset IDs.
`startedAt` identifies the first request seen by this handler; counters reset on
restart. Snapshot fields are independent atomic reads and can briefly disagree
under concurrent traffic. The metrics request itself is active in its snapshot.

`completed` counts handler exits, including rejections, cancellation and panic.
`statuses` contains counts for no response before abort, then 1xx through 5xx.
`latency` has disjoint buckets with inclusive upper bounds of 5, 25, 100, 500,
2500, 15000 and 300000 milliseconds, followed by an overflow bucket. Timings use
Go's monotonic elapsed clock. `writtenBytes` counts bytes accepted by the response
writer, including compressed output; it does not prove remote delivery.
`decodedJSONBytes` counts JSON emitted by the core API responder before compression and excludes
304/no-body responses. Cancellation, deadlines, write errors, stream aborts and
panics are separate handler counts (one per affected request); a 200 header on an aborted download is not a complete
transfer. `admission` exposes occupancy of request/result/cohort/download slots.
The response wrapper preserves streaming copies and ResponseController operations.

Storage metrics include `filesystem` capacity for the data-root filesystem,
independently of the application content quota. `availableBytes` is OS-reported
caller-available space, not a reclaimable-directory estimate. Linux/macOS use
`statfs`; Windows uses `GetDiskFreeSpaceEx`. Unsupported or failed readings return
`status=unavailable` with null capacities and no filesystem paths/errors exposed.

`writeStalls` uses Pebble's actual begin/end callbacks. Counts classify memtable,
level-0 and other stalls without retaining reason strings. `durationNs` includes
active stalls and sums writer-stall time if events overlap; it is not exclusive
wall time. Counters reset when the store opens. The listener does no storage work
and holds only its own short-lived accounting lock. A real pressure test blocks
SST I/O until a memtable stall is observed, then verifies resume/end accounting.

`resultQueries` reports fixed `selection` and `history` totals for calls to the
store result-query path, including internal cohort selections. Budget units count
index/selection/history traversal charges; `records` and `resultDataBytes` count
primary results examined at the filtering stage. They do not count all metadata,
proof-enrichment or disk I/O. Matches are complete-query selections, not returned
page rows. Failed/cancelled queries retain their partial work counts. Counters
reset with the store; snapshots are independent atomic reads.

The 32 MiB query data ceiling now charges rejected rows before parsing/filtering,
so an unindexed legacy query cannot evade the budget by matching nothing. A broad
query can require narrower filters even when its eventual page would be small.

`requests.caches` reports bounded result/history and cohort cache occupancy,
conservative accounted bytes, hit/miss counts, rejected inserts and evictions.
Accounting is the existing retention estimate, not measured RSS. No cache keys or
query identities are returned. Result cache hits bypass store selection; page size
is excluded from cache identity while signed cursor scope still includes it.

`GET /api/v1/history/series?scope=JSON&version=observed-minmax-v1&maxPoints=200`
returns a bounded exact series of original summaries. Scope pins revision,
environment, runtime track, workload contract, metric definition, method, scenario,
profile, statistic and a `from`/`until` window. The time axis is explicitly
`source-report-created`, matching the existing history indexes. Other historical
roles/source dates remain in separate history bindings; they are not substituted
for collection time. Missing/legacy method identity needs raw history access.

At most 1,000 requested points are returned under the ordinary 1 MiB response
ceiling and shared two-slot computation admission. Small series remain raw. Larger
series retain first/last and exact numeric extrema in ordered-observation buckets,
plus all nonnumeric records and neighbors. Values, statuses, reasons, provenance
and unavailable intervals remain in original records. `rawCount`, `reduction` and
`gapPolicy` disclose the representation. No intermediate or absent-period point is
created. Gap-heavy or oversized responses require a narrower window or raw paged
`/api/v1/history` access with the same filters. This display policy changes no
measurement analysis, uncertainty or matched-workload comparison calculation.

The proxy trust boundary has a retained real-socket integration gate:

```sh
GOFLAGS=-mod=readonly GOWORK=off go test -race ./internal/api \
  -run 'TestTLSProxy|TestRealHTTPDefault|TestTrustedProxy|TestProxyAddress'
```

The reference proxy terminates TLS, replaces all incoming `X-Real-IP` values
with the connecting socket peer, and forwards to the loopback API. Tests prove
that spoofing cannot create another public budget, exhausted public traffic does
not exhaust publisher access, trusted requests without a client header fail
closed, and the default policy ignores forwarding headers. Native Linux also
requires two real connecting loopback addresses to receive separate budgets
through one proxy hop. macOS can omit only that secondary-address subcase when
the OS has no loopback alias. These tests qualify the reference path, not an
operator's reverse-proxy/firewall configuration or a deployed TLS certificate.
The production proxy must overwrite the header and restrict direct API access.

Actual kernel disk exhaustion has a separate opt-in Linux gate. From the site
root, with Go and a native Linux Docker engine available, run:

```sh
./scripts/api-disk-full-test.sh
```

The runner compiles a static test binary for the native Linux Docker engine,
using `-trimpath` so fixture paths do not depend on the checkout location. It
builds a `FROM scratch` image containing only that binary and synthetic fixtures;
no preinstalled image, image pull or host-path mount is required. It runs as a non-root user with networking disabled, a
read-only root filesystem and a fresh 32 MiB tmpfs. The test refuses non-tmpfs,
nonempty, non-mount-root or larger-than-64-MiB exhaustion targets; ordinary Go test runs skip it.

Real kernel ENOSPC during a declared upload leaves no canonical partial object.
ENOSPC during publication leaves the previous revision readable. Freeing space
allows upload/publication retry, idempotent commit, restart and portable rebuild
with the same head and captures. The native Linux arm64 runner passes locally.
A second fresh-container gate exhausts the filesystem at the pre-commit
checkpoint, after all publication files are installed. With the pinned Pebble
version, the synchronous WAL write logs a fatal ENOSPC and terminates the helper
process. The test requires that specific WAL failure and checkpoint, frees space,
then verifies that restart retains the exact prior summaries. Missing-only retry
publishes once; another restart and DB-free portable rebuild retain the complete
new head and exact captures. The runner passes both gates on native Linux arm64.

Operators must free space before restarting a service terminated by a fatal WAL
write. These tmpfs tests do not qualify physical disk/device failures or power
loss. The API service workflow now runs the same script with a five-minute gate
limit. The scratch runner passes locally on native Linux arm64; actual GitHub
Actions execution and native amd64 exhaustion remain unqualified. Cleanup tracks
only this invocation's containers and image tag; it does not prune shared images
or builder caches.


Native byte `/bytes` and `/content` routes now support GET and HEAD with the same
revision membership, content verification, range rules and headers; HEAD emits no
body. Selected ranges and explicit original downloads share the two-slot download
pool with report files and parent archives. Pool saturation returns 429 while
ordinary metadata remains readable. Original `download=1` requests have the same
five-minute request/write deadline as other explicit file downloads; ordinary
selected reads retain the 15-second request deadline. A write failure aborts the
response and releases its admission slot.

Content verification reads and hashes at most 32 KiB per step and checks caller
cancellation before the next read. Artifact, selected report chunk and parent
archive readers propagate that context. Hash, declared size, confinement and
membership checks remain required. Cancellation cannot interrupt a regular-file
read already blocked inside the kernel; slow or failed physical filesystems are
outside this gate's qualification.


Preset registration now commits its seed projection and configuration in one
synchronous registry update. Quota is checked before preparation and again before
commit, so a failed or canceled registration does not publish a new projection.
Preparation uses a pinned revision outside the publication lock; existing
prepared views remain readable. At the projection ceiling, registration can evict
replaceable derived views in the same candidate, retaining presets and original
measurement records. Restart after a commit interruption recovers both entries
or neither; retry remains idempotent.


The native lifecycle smoke runner also accepts an existing producer export:

```sh
python3 scripts/api-service-smoke.py --binary /path/to/wasmfyi \
  --fixture /path/to/site-v2-export --source-report /path/to/sealed-report \
  --producer-binary /path/to/wasmbench --export /path/to/new-portable-bundle
python3 scripts/api-service-smoke.py --binary /path/to/other-platform-wasmfyi \
  --recover /path/to/new-portable-bundle
```

Run from the site root. Source mode invokes the producer's `verify-report`, binds
the export to the report/seal digests and retains the verifier binary hash.
Paged inventories activate through authenticated HTTP before missing-body
uploads; local object reads verify bounded sizes and hashes without retaining
all evidence bodies in memory. Publisher 429 retries share the same bounded
per-request deadline: 30 seconds for ordinary requests and five minutes for
explicit plan/import commits. The test association is synthetic, with no benchmark
execution or operator qualification claim.

Recovery uses only the portable bundle. It compares complete paged result/history
responses and signed cursors, and stream-hashes each explicit original report-file
download after restore and DB-free rebuild. Older bundles remain readable without
claiming checks their expectation files do not contain. Python optimization is
rejected so disabled assertions cannot produce a passing gate.


Completed-job and plan commits have a dedicated five-minute API context and
transport write deadline. The authenticated handler overrides the server's
ordinary 30-second writer limit; ordinary public reads keep their 15-second
context. The collection publisher uses the same five-minute commit budget across
rate-limit retries and response reads, while cancellation still stops the request.
This is a bounded publication operation, not an extension of normal read budgets.

The lifecycle runner logs each phase duration to stderr. Recovery CLI subprocesses
have a ten-minute validation limit; failures retain their isolated temporary store
and command/service logs, with the path printed to stderr. Successful runs remove
only their own temporary store. A larger import passing HTTP publication alone is
not a completed backup/restore qualification.

For an import-phase failure, add `--resume-store /path/printed/by/failed-run` to
redeliver the same fixture into that isolated store. This mode appends service
logs and keeps the supplied store after success as well as failure. It cannot be
combined with `--recover`, and it does not overwrite existing backup/restore
outputs. Transport failures identify the method, path and request budget.


Offline function disassembly uses the producer's existing sealed LLVM outputs.
`export-site` discovers `native-image-disassembly-v2` records in the verified
report's `code/` export and retains each attributed function's exact original
listing, image/module/range identity, tool executable hashes/versions, argv and
interpretation. `llvm-function-listing-v1` denotes the transport policy. It does
not imply independent redisassembly or pinned tool dynamic libraries.

Function shards explicitly reference their diagnostic resources. Original text
is split into independently readable chunks of at most 256 lines and 128 KiB
encoded payload; each line is at most 16 KiB, and each function has at most 4,096
chunks. Import/rebuild validate exact range/source identities, line counts and
the concatenated original text digest. Legacy function arrays remain readable;
missing bytes, unattributed images or absent sealed listings stay unavailable.

```text
GET /api/v1/artifacts/{id}/functions?revision={revision}&limit=100
GET /api/v1/artifacts/{id}/disassembly?revision={revision}&function=0&limit=100
```

`function` is the zero-based ordinal in the same immutable producer-order function
index. Follow the signed `nextCursor` to read subsequent line windows; it binds
revision, artifact, ordinal, derivative version and page limit. The response
includes exact function identity, tools, original text hash and recorded
interpretation. Lines retain newline bytes and original image-relative addresses.
Only the selected function and intersecting chunks are decoded. Ordinary JSON
still has the 1 MiB ceiling, and the endpoint never runs LLVM or native bytes.
Unavailable listings return 404. Descriptor and function pages advertise the
available derivative without fetching its body.

New derivative descriptors may include a `source` attestation with embedded or
external archive origin, exact code-pass ID, raw code seal digest and native
archive seal digest. Serving preserves the explicit `producer-asserted` label;
these identities do not advertise an original-archive download or establish
independent API verification of evidence that was not imported. Admission binds
the attested pass to the native image's recorded pass. Older descriptors lacking
this optional field remain readable. The source format may be full-image v2 or
function-only `native-image-disassembly-v3`; transport windows retain their exact
source format and interpretation.

The opt-in real producer parity gate accepts an additional `Disassembly` archive
path in each `WASMFYI_REAL_REPORTS` entry. It stream-reads native archive records,
retains selected first/middle/last function paths, and checks complete HTTP line
windows, exact original text, range identities and source seals for every linked
image. `WASMFYI_REAL_PENDING_BYTES` sets an explicit fixture quota between the
512 MiB default and 8 GiB; it does not change production defaults. An optional
`WASMFYI_REAL_STORE` must name a new directory and retains that test store for
inspection. Synthetic session/job association and original measurement parity
remain distinct from new collection or operator qualification.

The code-size oracle preserves the producer's distinction between engine-reported
`size_bytes` (`native.code_size`) and materialized `image_bytes`
(`native.code_image`), including zero and exact integer strings. To check those
source/export populations without importing a store or running recovery, use:

```sh
WASMFYI_REAL_REPORTS='[{"Source":"/absolute/report","Export":"/absolute/site-v2"}]' \
  go test -race ./internal/api -run 'TestRealCodeExportParity|TestRealCodeOracle' -count=1 -v
```

Run from `service/`. This checks source/seal commitments and compact result values;
it does not establish HTTP or portable-recovery parity. The full serving gate
checks both native metrics before beginning backup and DB-free rebuild.

Catalog and canonical record-detail responses now have endpoint-specific schemas
and generated types. Catalog pages bind each row to the requested record kind,
contain at most 1,000 returned rows, and require a nonempty successor exactly
when `complete` is false. Detail responses contain only the resolved revision
and canonical record envelope. Result details use the full producer-result
schema; summaries continue to omit evidence references. Other catalog `data`
objects preserve producer-owned metadata fields rather than define a second
scientific namespace. The response byte ceiling is enforced separately by the
HTTP writer. Captured HTTP tests validate all eight kinds, selected successors
and pinned page/detail bytes after another publication; negative schema tests
reject wrong kinds, unbounded pages, misleading continuation and extra preload
fields. The workflow includes these captures in its executable contract gate.

Authenticated import status observes the HTTP request cancellation while counting
declared inventories and finding missing objects. Canceled reads leave staging
and publication unchanged. Status responses expose `staged`, `published` or
`aborted`; only published receipts carry a revision. Missing-object pages contain
at most 100 descriptors and may include `kind: "inventory"` until that page is
installed and attached. Pending inventories make `missingComplete` false, so
the returned missing count is not a complete evidence census until discovery
finishes. Plan discovery returns at most 16 chunks. These responses have explicit
OpenAPI schemas, generated types and captured HTTP contract checks.

Publication permit release observes caller cancellation between owner records.
Canceled candidate batches do not release quotas or shared upload permissions.
Import abort acquires publication ownership cancelably and preserves pending
state on cancellation; plan commit/abort use the same release checks. A final
context check precedes synchronous publication. Kernel filesystem/database
syscalls already in progress still have their existing interruption limits.

Artifact descriptors have a decoded 10 KiB response target enforced at producer
export and consumer admission, reserving 512 bytes for the record/API envelope.
Their typed response contract separates measured size from original content and
inspection. A valid size-only code record retains its original size while raw
content and inspection remain unavailable. Downloadable content requires a
hash, original byte count and media type; offline inspection binds metadata and
a versioned derivative. Function indexes and listings remain selected resources.

A history binding can carry `targetDates` for one source capture reused by several
planned calendar dates. Lists contain one to 256 sorted, distinct valid dates;
`targetDate` and `targetDates` are mutually exclusive. These aliases do not add
result/history rows or independent samples. The completed-job publisher accepts
`result.historyBindings`, retaining the existing explicit argument override.
Bindings remain immutable publisher assertions tied to an exported report and
exact configuration; changing an existing attempt's interpretation is rejected.

`/api/v1/configurations` serves `configuration-display-v1` summaries with exact
canonical IDs and recorded display/capability facts. Invocation commands, local
dependency paths, build strings and effective configuration maps are fetched
explicitly through `/api/v1/configurations/{id}`, whose original bytes remain
intact. Summary pages name their projection; pin both `revision` and
`projection=configuration-display-v1` for immutable caching. Unversioned display
projections revalidate, and cursors bind the projection version. This changes
catalog loading, not measurement identities or cohort selection.
