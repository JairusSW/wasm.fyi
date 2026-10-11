# Compact storage and scoped browsing

Status: implementation in progress. Existing observations must remain lossless.

## Baseline

The active Pebble database is approximately 224 MiB. Apple, Hub and Remote JSON
capture copies occupy roughly 707 MiB locally. SDKs and source caches are separate
from measurement data and must not be confused with database overhead.

A first steady page contains about 1,016,000 uncompressed bytes and 9,845–11,935
ordered samples. Startup loads four phases for all three machines, then every
historical page. The layout repeats connection/loading every 30 seconds.

## Required outcome

- Home and machine status use precomputed counts, coverage and freshness.
- Main tables request only the selected machine and view, with scalar values and
  statuses. Ordered samples, detailed metadata and history do not travel with them.
- Shared/per-engine cohorts, arithmetic/geometric means, corpus/workload weighting,
  zero-valued timing, native-code eligibility and compiler exclusions retain their
  current behavior. Server summaries must be checked against existing calculations.
- History requests one selected machine, metric, date window and optional workload.
- A detail request supplies ordered samples and distributions only when opened.
- Cache bounded responses by scope and revision; coalesce in-flight identical
  requests. Poll a lightweight revision/status document rather than all records.
- Every engine, backend, source identity, capture time, status, memory/code metric,
  sampling policy and ordered floating-point sample survives migration.
- Store source/display/policy metadata once. Store observations once and reference
  them from latest and historical indexes; aliases must not duplicate samples.
- Encode sample vectors without rounding, using binary IEEE-754 doubles and
  compression. Keep full acquisition order and retained-start metadata.
- Archive original capture input in compressed, indexed batches rather than many
  repeated JSON files. Preserve provenance and exact input bytes where retained.
- Publisher bookkeeping uses incremental records instead of rewriting an entire
  SHA ledger for every imported workload.

## Storage decision

Use embedded SQLite, following the user's explicit SQL preference. Normalize
machines, engines/configurations, source snapshots, workloads/contracts,
observations and weekly/latest bindings with integer IDs and foreign keys. Use WAL,
indexed queries, prepared statements and short write transactions. Store ordered
sample vectors as lossless binary blobs inside SQLite. Store all measurement and
provenance data in the database, without capture-file or sample-dump references.
Collector JSON remains transport input only; serving imported data never reads it.
Materialize browsing summaries separately from observations.

The old Pebble copy remains a verified migration baseline. Its 442,768 records
round-trip with digest
`edb2ae22552b6477d1276110f6a063b932c4ea90b4a93e8c34b84f068db8a165`.
Shared objects and Zstd reduced this copied database from 225 MiB to 145 MiB, but
SQL provides a simpler fit for the relationships and scoped queries. That result is
a baseline, not the final migration or acceptance claim.

## Delivery sequence

1. Capture baseline payload/storage/request counts and a reproducible loading check.
2. Implement compact observations, metadata/sample deduplication and migration.
3. Materialize counts/freshness and table/history aggregates at publication time.
4. Add bounded summary, matrix, history and detail interfaces with ETags.
5. Replace eager browser imports with scoped fetching and bounded caches.
6. Verify migration equality, aggregate parity, details and UI interactions on a
   copied real dataset. Verify cold/warm requests and that idle refresh transfers
   no unchanged data. Build and deploy locally under the device reservation.
7. Report measured differences and resume directing the benchmark campaign.

## Acceptance

Initial home/status responses contain no raw samples or historical measurement
dump. Opening a table never triggers other-machine history requests. Details retain
all samples. Reopening an unchanged view reuses its cache. Cancellation and revision
changes cannot mix datasets. Migration compares reconstructed records and ordered
sample bits, preserves original data until verified, and supports rollback. Tests
cover missing/unsupported/error states, zero timings, resource-only enrichment,
aliases, source selection, shared cohorts and publication during browsing.

## SQLite acceptance so far

The native SQLite copy migration verified **442,768 latest/history bindings** plus
all legacy metadata against an order-independent SHA-256 digest of reconstructed
records: `1645a3dbe447f145b0baef191c202bbeb28864ae6645f6c037ff44c709faac64`.
It completed in 69.9 seconds, preserved ordered samples, and passed SQLite and
foreign-key integrity checks. This is a copied dataset; final live cutover follows
UI acceptance and a fresh migration.

On that copied dataset, the summary response was 1,335 bytes and the handler took
119 microseconds. The first 1,000 steady rows per machine packed to 128–137 KB,
with roughly 13 ms median handler time (seven requests per machine). These are
local handler measurements, excluding network/browser time, not a claimed
cross-database engine benchmark. Original uncompressed first pages were roughly
1 MB for fewer rows. Native SQL disk size is currently about 160 MiB, with exact
values preserved; old database copies remain rollback material during acceptance.

Materialized alias-deduplicated counts and freshness are maintained atomically by
SQL triggers, with one transactional backfill for older SQLite copies. Browser
fetches coalesce, queue at four concurrent requests, and retain at most 64 entries
or 8 MiB. ETag polling avoids retransferring unchanged metadata. Packed tables
contain scalar values and observation IDs; full ordered samples load on demand.
Frontend type checking passed; queue/cache, lossless migration, matrix packing,
revision pagination and materialized-total tests passed. Visual acceptance and
server-side scoped comparison aggregates remain in progress.

## Local cutover completed

On 2026-10-10 the live local store migrated 472,128 latest/history bindings,
verified by full semantic digest `02df9590a0dece5e25f56cbf31190e7a86d372022d58b55cab16525ff588cef9`.
The migration took 99.23 seconds. Previous storage: 244,244 KiB; SQLite:
180,328 KiB (26.2% smaller). The previous store remains a rollback copy.

Local `http://localhost:8080` is serving SQLite. Actual Chrome checks passed for
home, benchmarks, features and health with no runtime errors, including a lazy
sample detail request and rendered ordered-sample distribution/std deviation.
Home and health issue no matrix or history downloads. Browsing summary is 2,076
bytes for all three machines. The SQL suite passes a regression that moves only
the checkpointed SQLite file, deletes original database and JSON transport
folders, and then verifies exact metadata, metrics and ordered IEEE sample bits.

Collector files are transport input to ongoing campaigns, not database references.
Deleting them automatically would interfere with campaign deduplication and sync;
serving/imported SQL data does not depend on their continued existence.

## Compact history cutover

Historical graphs now fetch `/api/history/summary` (weekly scalar points), and
one `/api/history/comparison` request for a selected range. Detailed reports use
`/api/history/report` for the selected runtime only. No historical row pages or
sample vectors are downloaded for graphs. Direct `/history/` also avoids current
matrix downloads. SQL caches use both latest-reference and historical revisions.

Copied real-data graph payloads: Hub 241,026 bytes / 24 dates, Remote 176,980 bytes
/ 16 dates, Apple 204,850 bytes / 22 dates (uncompressed). Cold handlers took
0.52–1.16 seconds; cached handlers took 1.4–1.9 ms. Actual localhost Chrome proof
rendered benchmark history in 540 ms with one summary and one comparison request,
195 markers, no raw historical rows, and no runtime errors. Re-scrolling reused
the completed graph without another summary request. The local server restarted
with the same SQLite data directory; no second data migration was needed.
