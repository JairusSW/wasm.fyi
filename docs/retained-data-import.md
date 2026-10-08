# Retained snapshot import

The migration inventories `data/wasmbench`, `data/history`, and
`data/history-hub` and resolves their retained producer reports/projections.
The inventory currently contains 29,380 distinct reports. Existing scientific
summaries and observations are exported by the harness without resampling.

The producer's explicit `export-retained-site` command emits
`site-v2-retained`, with verification `retained-projection-integrity-checked`.
This checks retained input/receipt hashes. It does not assert independent
recomputation against source passes that are no longer present. Original producer
and seal identities remain in retained receipt evidence. Normal collection still
requires the `site-v2` / `source-recomputed` contract.

The serving dependency closure remains independent of the harness and SQLite.
The offline writer accepts bounded migration jobs. Historical jobs append evidence
and historical indexes without replacing current/previous measurement selections.
Explicit date aliases preserve reused fixed baselines and retrospective source
captures. Collection dates and dataset publication dates remain separate.

Original website reports, trial/throughput files, producer data and checksums,
dataset indexes, history manifests and parent tool archives are retained as
individually described report files backed by local content-addressed bytes.
Parent archives are stored once per collection member. An importer never executes
archived tools. Missing source pass methods and unavailable native content remain
explicit; integrity checking does not manufacture those resources.

## Run and resume

Build the trusted producer's `export-retained-site` implementation into
`.wasmbench/retained-exporter` and the offline writer with:

```sh
cd service
GOWORK=off GOFLAGS=-mod=readonly go build -o ../.wasmbench/import-retained ./cmd/import-retained
cd ..
node scripts/migrate-retained-data.mjs DATA_DIRECTORY .wasmbench/retained-api-inventory.json
```

Use a separate restored destination while the site serves the previous database.
Each completed batch commits synchronously before its checkpoint advances. The
checkpoint directory includes a digest of the destination path. Rerunning resumes
that destination. The importer stops below 8 GiB of free space and retains all
original sources. It does not delete snapshots or recovery backups.

The offline writer defers the full scan of previously imported evidence on
resume, including the per-file inventory used for total storage accounting.
Its content-byte allowance bounds newly installed bytes during that process;
the driver's free-space cutoff protects remaining disk headroom. Ordinary
startup restores total storage accounting. The writer still checks the committed revision chain, validates each new import
and commits files and indexes durably. This destination must stay offline until
the final audit succeeds. The audit and ordinary server startup use the full
integrity scan; the serving binary cannot select the deferred migration opener.

Offline bulk writes use private temporary filenames until their file contents
have been synced. The importer syncs installed directory entries before committing
a revision root. This mode is restricted to an offline owner; ordinary API
publication retains its existing durability behavior.

The final cutover updates `.wasmfyi/local/data-directory` and restarts `just dev`.
Verify catalogs, both hosts, current/previous cells, declared historical dates,
artifact availability and explicit downloads against the retained sources before
removing any old storage. No source removal is part of this migration.

The offline command admits up to 8 GiB of pending archive content in a bounded
batch; the online publisher keeps its existing admission limits. Up to four
trusted exporter processes prepare reports concurrently without executing any
measurements or archived tools. On macOS, each staged file receives `fsync`, then
the content directory receives Go's drive-wide `F_FULLFSYNC` after installation
and before publication. Other platforms retain `File.Sync` for each object.

After migration completes and its writer exits, audit every report's original
files and shared parent archive against the published database:

```sh
cd service
go build -o ../.wasmbench/audit-retained ./cmd/audit-retained
cd ..
.wasmbench/audit-retained --data DATA_DIRECTORY \
  --inventory .wasmbench/retained-api-inventory.json \
  --checkpoint .wasmbench/retained-migration-DESTINATION_DIGEST/checkpoint.json
```

The final metadata report stores the original collection plans and calendar,
along with the report, dataset and shared-parent migration map. Original source
file digests remain available independently of their decoded API summaries.

The offline writer discards only newly generated private index pages that are
absent from the final publication metadata closure. Its conservative reference
walk preserves producer inputs, non-index metadata and all previously installed
objects. This avoids installing intermediate pages created within an import
batch. Crash/reopen tests check this publication boundary.

Some retained C AOT summaries name `process_tree.rss.mean` while their saved
metric registry omits its definition. These results retain an explicit
`unregistered` definition marker and their original values. The migration does
not invent a metric definition; comparisons requiring registered definitions
continue to reject them.

Reachability/startup validation uses a private 16 MiB cache for verified objects
of at most 16 KiB. It lasts for one validation operation and is discarded afterward.
The serving store retains no such cache between requests; a later validation pass
and ordinary reads still detect changed or corrupt files. This reduces repeated
filesystem reads while validating shared immutable metadata.
