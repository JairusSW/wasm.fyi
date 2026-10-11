# Benchmark database

The local service uses native embedded SQLite (`mattn/go-sqlite3`), with WAL,
foreign keys, indexed queries and atomic write transactions. Imported data is
self-contained: measurements, all metadata and every ordered sample are inside
`benchmarks.sqlite`. Serving data never opens capture JSON or sample dumps.

| Table family | Stored data |
|---|---|
| Platforms, engines and configurations | Host specs and runtime/backend identities |
| Workloads and contracts | Workload IDs, Wasm filenames and artifact/contract hashes |
| Sources and snapshots | Exact repository/revision labels and weekly source dates |
| Observations | Scalar metrics, statuses, capture times and shared metadata references |
| Sample vectors | Lossless binary IEEE-754 values in acquisition order |
| Latest/history bindings | Current cells and retained weekly aliases |
| Metadata and summary totals | Revisions, counts and import freshness |

Integer foreign keys and shared vectors avoid repeating metadata or samples.
Exact metric bits preserve nullable values and floating-point identity; numeric
columns support efficient SQL queries. Retained sample statistics are calculated
once at ingestion and stored numerically. Raw vectors are fetched only for an
individual observation detail request.

Publication validates the whole capture before committing. Delayed captures do
not replace newer cells; equal-time retries are idempotent. Latest and history
revisions are independent per platform, so unrelated imports do not invalidate
an open machine's latest table or graph.

Startup merges zero-memory host records only when exactly one otherwise
identical host has known memory. The repair preserves observations and ordered
sample vectors, moves latest/history bindings atomically, and archives the
original host metadata. Scalar fields decide ordinary conflicts; vectors are
loaded only for possible equal-time code enrichment. Retiring host summaries
are removed within the transaction before binding deletion, avoiding repeated
timestamp scans, then canonical totals and revisions are rebuilt.

Browsing tables use dictionaries and scalar rows. Current comparison cards and
historical graph points are aggregated on the server, using bounded caches keyed
by the relevant revisions and selection policy. History holds the current
reference corpus fixed, computes comparisons on matched contracts, and returns
workload detail only for the selected runtime and range. Code/RSS values remain
explicitly unavailable when not measured; missing values are never invented.

The CLI auto-detects SQLite when the file exists. `migrate-sql` writes a separate
store, verifies every latest/history binding and metadata item against the legacy
store, and checks SQLite integrity and foreign keys. It retains the original
store for rollback. The local cutover verified 472,128 bindings on 2026-10-10.
A regression also moves only the checkpointed SQLite file, deletes original
storage and transport folders, and verifies all metadata, metrics and sample bits.

Collector JSON files remain transport inputs to independently running machine
workers and synchronizers. They are not database references. Worker deduplication
and retention must be coordinated before removing transport files. Runtime SDKs,
compiled benchmark artifacts and build caches also live outside the measurement
database and remain reusable by the campaign.

## Production SQLite deployment

The live site stores its database at `/var/lib/wasmfyi/benchmarks.sqlite` on
Remote. The October 10 deployment copied a consistent SQLite backup from the
local live database, including binary sample vectors and all retained history.
The previous release and legacy database remain available for rollback.

Database replacement pauses the production publisher and API, installs the
verified snapshot, and seeds the publication ledger from receipts captured
before that snapshot. Captures produced afterward remain eligible for import.
Validate the uploaded snapshot using a disposable database copy: opening SQLite
can update its journal-mode header. Direct API checks on the production listener
must supply the trusted proxy client-IP header, or use Caddy's public URL.
