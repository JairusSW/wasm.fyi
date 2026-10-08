# Benchmark service

`wasmfyi serve` runs the compact benchmark database and HTTP service. It stores
latency, kernel peak RSS and native code size, plus deduplicated platform, engine
and workload metadata. The four-route API and its cursor-based reads are documented in [API.md](../API.md).

```sh
just serve-local
just bench
```

The default local data root is `.wasmfyi/local/data`; the Pebble database is its
`benchmarks/` subdirectory. No evidence/CAS directory, import pipeline, report
rendering or prepared-page export is needed. Reads use indexed MVCC snapshots;
writes replace newer cells in one synchronous batch. The publisher token stays in
`.wasmfyi/local/admin-token` and must not be committed.

For offline capture import, stop the owning server and run:

```sh
wasmfyi ingest --data /path/to/data --input capture.json
```

Use `--read-only` to disable publication. Keep `--listen` on loopback and use a
trusted HTTPS reverse proxy for remote access. Copy the database directory only
while the server is stopped. Schema-version mismatches fail explicitly.

The old immutable report store remains in source for legacy tools and tests; it
is not opened by ordinary serving and is not migrated into the new database.
