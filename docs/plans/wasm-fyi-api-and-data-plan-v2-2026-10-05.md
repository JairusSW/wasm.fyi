# wasm.fyi API and Data Plan — Revision 2

**Reviewed:** October 5, 2026\
**Target:** Locally hosted Go API, Pebble, immutable local evidence files, existing SvelteKit UI.\
**Status:** Implementation plan; no repository changes or new benchmark measurements were made.

## 1. Decision and review scope

Keep the previous storage decision: **Pebble for small indexed records and local content-addressed files for large content.** No SQLite, MongoDB, Redis, S3, or separate database daemon in the new serving deployment. Pebble provides ordered iteration, atomic batches, synchronous durability options, and checkpoints. Its database format is not an interchangeable RocksDB data directory. [P1](https://pkg.go.dev/github.com/cockroachdb/pebble/v2)

The substantial change is the integration boundary: **extend wasm-bench's verified producer and wasm.fyi's existing collection workflow instead of constructing another benchmark backend.**

| Reviewed component | Exact revision or source |
|---|---|
| `JairusSW/wasm.fyi` main | `daf09f4810cd8229e521c462c93eae4292db306e` |
| `JairusSW/wasm-bench` main | `a017c56fef370a54ffa33ca49ad9b6827e127cc4` |
| Harness revision configured by the site | `0509a0a323f41c58a2f2db15a372fb2e63c692bf` |
| Latest successful main deployment returned during inspection | `101850b696fdfbb4a5c8926b188ba4947e111a3b`, Actions run `37367026033` |

These are different identities. A site's configured harness version, the harness repository's latest version, a recorded run's controller, and the successfully deployed UI are not automatically the same. Preserve all applicable identities in provenance. [R1](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/wasmbench.config.json) [R2](https://github.com/JairusSW/wasm-bench/commit/a017c56fef370a54ffa33ca49ad9b6827e127cc4) [R3](https://github.com/JairusSW/wasm.fyi/commit/daf09f4810cd8229e521c462c93eae4292db306e) [R4](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/README.md) [R20](https://github.com/JairusSW/wasm.fyi/actions/runs/37367026033)

The live homepage, benchmark page, LLM index, and JSON manifest were readable on retry. The history page did not return through the web reader, so its deployed HTML and source were inspected instead. The successful deployment archive was downloaded and analyzed locally. Payload figures below are extracted sizes and local compression experiments, not live network traces or browser heap measurements. [L1](https://wasm.fyi/) [L2](https://wasm.fyi/benchmarks/) [L3](https://wasm.fyi/llms.txt) [L4](https://wasm.fyi/data/llm/index.json) [A1](wasm-fyi-audit-2026-10-05.json)

## 2. What the current implementation changes

| Earlier assumption or proposal | Updated implementation decision |
|---|---|
| Create the collection/import architecture around a new API. | Keep the existing resumable session coordinator, SSH workers, corpus cache, and per-corpus publication boundary. |
| Introduce packed trial records and separate sample files. | These already exist as `interned-columns-v1`; extend them with bounded chunks rather than replacing them gratuitously. |
| Port measurement analysis into a new service implementation. | Reuse the harness's Go analysis, metric registry, and exports. Only the site's additional selection/aggregate policies need extraction and parity work. |
| Aggregates require one locked report. | Current site aggregates merge host-local sealed reports. Preserve per-cell provenance and define comparability explicitly. |
| Peak RSS comes only from a separate memory pass. | Timing trials can also supply process-lifetime peak RSS; retain source run/profile/collector. |
| Code size and code availability are one status. | Represent size measurement, raw export, and inspection availability independently. |
| Add native-code inspection from scratch. | An exporter already verifies and writes binary images plus function metadata. Integrate and bound its output. |
| Rebuild an entire dataset publication after a collection. | Commit each complete corpus result as a small dataset revision, reusing unchanged shards. |
| All metadata can be one small bootstrap response. | There are 13,474 report descriptors in the inspected deployment; report catalogs must be paginated and reference-loaded. |
| Keeping Go code automatically avoids SQLite. | The harness already has a SQLite index/job queue. Do not import that storage layer into the new API. |

The supporting code is in the current benchmark workflow, importer, exporter, aggregate module, report builder, metric definitions, and storage package. [R5](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/docs/benchmark-workflow.md) [R6](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/import-wasmbench.mjs) [R7](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/lib/wasmfyi-export.mjs) [R8](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/src/lib/aggregates.ts) [R9](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/publish/report.go) [R10](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/metrics/registry.go) [R11](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/publish/code_pair.go) [R12](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/storage/index.go) [R13](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/docs/TOOL-ARCHIVES.md)

## 3. Measured payload baseline

Local measurements of the successful deployment use decimal MB/kB and Brotli quality 5:

| Resource | Uncompressed | Locally Brotli-compressed |
|---|---:|---:|
| Largest client JavaScript chunk | 36.02 MB | 2.96 MB |
| `data/llm/reports.json` | 34.57 MB | 1.79 MB |
| `wasmbench/index.json` | 10.38 MB | 51.6 kB |
| `wasmbench/history/index.json` | 10.66 MB | 1.46 MB |
| Current steady-result shard, 1,008 results | 395.0 kB | 22.2 kB |
| Same 1,008 summary results in matrix prototype | 47.1 kB | 14.6 kB |
| A 100-result page in the matrix prototype | 5.47 kB | 1.93 kB |

The matrix experiment preserves values, units, intervals, outcomes, reasons, report references, and existing workload/configuration identities; it omits `launchMedians` from the summary response. It is an encoder prototype, not an implemented API. Legacy slot IDs are retained solely for round-trip testing, not endorsed as the new public identity contract. [A1](wasm-fyi-audit-2026-10-05.json) [A2](wasm-fyi-compact-100-results-2026-10-05.json)

The ZIP archive is 44.6 MB; the extracted files total 454.8 MB. Neither is the cost of an ordinary page load. The report descriptor inventory contains 13,474 entries; the current report index has 370 entries and one history index has 9,240. [A1](wasm-fyi-audit-2026-10-05.json)

**Priority: eliminate global loading and expansion first.** The current view module imports all measurements and eagerly reconstructs both hosts, both selection slots, and history. A single metric shard already compresses well; changing JSON to a binary format alone does not address that dependency graph. [R14](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/src/lib/view-data.ts)

Do not assume every options object is identical: 13,447 distinct complete option objects appear in the report inventory. Factor genuinely shared subdocuments and move full options to report detail; do not merge different recipes to improve a compression ratio. [A1](wasm-fyi-audit-2026-10-05.json)

## 4. Ownership and deployment

### 4.1 Repository responsibilities

**wasm-bench owns measurement truth:** locked input/configuration identities, admission and verification, raw evidence, metric/scenario definitions, per-pass summaries, native-image extraction, and analytical exports. Its report builder already exports Parquet for several evidence types. [R9](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/publish/report.go) [R10](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/metrics/registry.go) [R15](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/README.md)

Add a public, versioned export boundary alongside the existing report builder. It must reuse the same validated dataset and numerical results. It should not round-trip through the website's legacy flattened model.

**wasm.fyi owns product policy and serving:** existing collection orchestration, corpus selection/editorial metadata, dataset revision selection, comparison cohorts, the Pebble index, public API, UI, and crawler resources. Keep the current coordinator rather than moving execution onto the public server. [R5](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/docs/benchmark-workflow.md)

The Go API serves immutable summaries and content. It never executes uploaded Wasm, archived adapters, or an archived report-builder executable. Benchmark workers remain trusted local/SSH machines; the existing runner is not an untrusted-submission sandbox. [R15](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/README.md)

### 4.2 Dependency boundary

The harness module currently declares `github.com/wasmbench/wasmbench`, while the inspected repository is `JairusSW/wasm-bench`. Establish a resolvable, pinned package/release arrangement before adding a cross-repository Go dependency. Do not require an undocumented local `../../Tools/wasm-bench` replacement in a deployed service. [R16](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/go.mod)

Initially, integrate through the versioned export format and retain precomputed harness summaries. For shared computations, expose small schema/pure-analysis packages without importing the complete CLI, runner, adapters, or SQLite `storage` package. Existing `analysis` imports experiment types, so verify the actual dependency closure before treating it as a lightweight leaf package. [R12](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/storage/index.go) [R16](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/go.mod) [R17](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/analysis/statistics.go)

Add a CI dependency check that the API binary does not include the SQLite driver or measurement execution entry points. The standalone harness's existing SQLite queue can remain outside this serving architecture. Replacing that separate queue is not a prerequisite and must not silently change its claim/recovery semantics.

### 4.3 Local layout

```text
wasmfyi-data/
  db/                         Pebble, one process owner
  blobs/sha256/ab/<digest>     Immutable exact content
  representations/            Compressed representations and their hashes
  revisions/                  Portable manifests and shared index pages
  responses/                  Regenerable bounded response cache
  imports/                    Staging and durable import state
  backups/                    Local checkpoint assembly area
web/                          Built Svelte assets and application shell
```

One Go process is the database owner. A TLS reverse proxy is optional. Existing Node-based collectors run where they already run; retaining them does not require a Node database service.

## 5. Model the collection hierarchy that already exists

```text
Collection session
  -> machine/session member and parent tool bundle
     -> corpus job
        -> attempt
           -> timing / memory / code pass
              -> trial and samples
              -> summary result
```

The current coordinator groups contracts sharing a Wasm artifact into a corpus job, retains immutable plans and scripts, skips completed jobs on resume, and restarts interrupted corpus attempts from compilation. Completed failures/unsupported outcomes remain evidence; infrastructure failures are different. Preserve these behaviors. [R5](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/docs/benchmark-workflow.md)

Define these application entities:

| Entity | Identity and role |
|---|---|
| Runtime / track | Human-facing engine family and stable backend/mode lane. |
| Configuration revision | Exact runtime, backend, revision/build, flags, target, adapter, and tool identities. |
| Machine / environment | Stable machine alias separately from versioned hardware/OS/policy facts and individual observations. |
| Collection session / member | Existing session plan plus one machine's recipe, prepared tools, and state. |
| Corpus job / attempt | Locked workload selection and the complete attempt eligible for ingestion. |
| Pass / trial | Exact recorded timing, memory, code, or other profile and its raw identity. |
| Workload / contract revision | Logical workload name separately from exact module, input, export, oracle, reset, ABI, and units. |
| Result | Canonical scientific result plus evidence/analysis identifiers. |
| Artifact / blob | Contextual descriptor separately from exact reusable content. |
| Dataset revision | Immutable selection of catalog, current/previous results, history, and policies. |
| Cohort | Exact comparison membership, coverage, exclusions, and analysis policy. |

Use full hashes for byte identity and versioned deterministic encodings for derived IDs. Preserve source run IDs; additionally namespace globally by full run/lock/source identities rather than trusting directory names to be unique across hosts.

A rebuilt workload keeps its logical name but gets a new contract revision. Historical results continue to reference the old revision. A shared module does not mean identical workload inputs. A relocated archived executable does not necessarily have the same path-bound configuration identity; keep that distinction from the harness. [R13](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/docs/TOOL-ARCHIVES.md)

Environment matching must be deliberate: a display alias is not proof of identical hardware or policy. Conversely, collecting a timestamp should not create a completely new comparable environment. Keep a versioned identity recipe and separate per-run observations, CPU assignments, concurrency, and host-control evidence.

## 6. Producer export v2

### 6.1 Extend, do not discard, existing exports

The current site already creates a sealed transport projection, splits trials/throughput, interns strings, and retains the original report on its producer. It still builds whole report objects and transfers more context than a browser page needs. [R6](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/import-wasmbench.mjs) [R7](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/lib/wasmfyi-export.mjs)

Introduce a new versioned export manifest, produced by a proposed harness command such as:

```sh
# Proposed command; not an existing CLI contract.
wasmbench export --report <verified-report> --format site-v2 --out <new-directory>
```

Keep legacy report/export readers. New export records reference bounded content instead of embedding all trials, timelines, and configuration metadata. Existing sealed files retain their bytes and hashes; this change does not require modifying historical protocol frames.

The root manifest records export/schema versions, source report and seal hashes, actual controller and exporter identities, collection/session/job/pass links, summary shard references, evidence references, and verification state. Record separate versions for independent analyses already versioned by the harness, not one ambiguous schema number. [R9](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/publish/report.go)

### 6.2 Publication package boundaries

```text
manifest.json                         Small root and provenance
catalog/<hash>.json                   Referenced bounded entity records
summaries/<hash>.json                 Small result groups
samples/<hash>.json.<encoding>        Independently decoded sample chunks
observations/<hash>.json.<encoding>   Collector-defined observations
artifacts/<hash>.json                 Descriptors / paginated indexes
blobs/<hash>                         Original bytes or explicit representations
```

Group small records by corpus/pass and access pattern. Avoid both one file per tiny sample and one file for the complete history. Chunk inventories must themselves be bounded.

Produce output incrementally per complete job. Avoid a publisher that parses all 13,474 historical report descriptors, rewrites all current selections, and regenerates every history point whenever one corpus finishes. Use bounded staging and deterministic ordering. If the existing report builder must still materialize a complete report, isolate that existing cost; the export/API must not add another global materialization.

Use the existing Parquet outputs for optional bulk analysis. Do not require a browser Parquet engine for the normal site and do not rebuild exports the harness already provides. [R9](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/publish/report.go)

### 6.3 Trust and qualification

Track byte-integrity verification, full-source verification, trusted-producer attestation, and operator-qualified publication separately. The current projection receipt contains source hashes, but checking a projection's own hash does not independently prove it was correctly derived from unavailable source bytes. [R6](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/import-wasmbench.mjs) [R7](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/lib/wasmfyi-export.mjs)

For authenticated trusted-worker imports, retain the attestation and validation level. For independent source verification, retain or retrieve the actual source material and use an explicitly trusted verifier. Never execute an archived verifier automatically. Continue requiring independent operator-key verification before labeling evidence qualified. A checksum alone is not qualification or authenticity. [R6](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/import-wasmbench.mjs) [R15](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/README.md)

## 7. Canonical measurements and comparison semantics

### 7.1 Reuse metric definitions

Use the harness registry's canonical name, definition version, unit, scope, boundary, and missing policy. A public measurement selector includes scenario, profile/source profile, denominator, collector identity/version, and analysis method when relevant. UI aliases such as `steady` can remain, but resolve to this complete definition. [R10](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/metrics/registry.go)

Do not invent a second scientific metric namespace merely to match page tabs. A view metric is a versioned projection of canonical metrics.

### 7.2 Memory requires more than one number

Retain these distinctions:

| Measurement | Required interpretation |
|---|---|
| `process.peak_rss` | Whole child-process lifetime peak, with actual source pass/profile. |
| `process.rss` | Resident memory at the recorded observation boundary. |
| Current average-RSS view | Arithmetic mean over selected available boundary observations, with boundary/workload counts and weighting. |
| Go/Rust allocator metrics | Allocator-defined accounting, not process RSS or physical retained memory. |
| Guest logical memory | Accessible guest memory, not resident host footprint. |

Timing-pass RSS is one peak per timing trial, not one peak for each inner timing sample. Separate memory profiles remain independently identifiable. [R10](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/metrics/registry.go) [R13](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/docs/TOOL-ARCHIVES.md)

The current average-RSS aggregate uses each configuration's available boundary cells. Preserve this existing calculation as an explicitly named policy for parity, expose the populations, and add a matched-population comparison mode separately. Do not silently describe those unequal populations as one shared workload cohort. [R8](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/src/lib/aggregates.ts)

### 7.3 Outcomes, precision, and uncertainty

Preserve raw outcomes separately from headline eligibility: a trial can execute successfully while a particular measurement is withheld. Preserve zero, missing intervals, not applicable, unsupported, crash, timeout, failed verification, and not collected where source evidence distinguishes them. Do not fabricate distinctions absent in legacy data.

Retain source numerical precision. Encode out-of-range exact integers as schema-declared decimal strings rather than silently rounding them through JavaScript numbers. Display formatting is not stored measurement precision.

Current default collection uses one independent launch with multiple inner samples, and call probes use their own high-operation recipe. Multiple inner samples do not create multiple independent process launches. The harness's summary bootstrap requires at least three independent launch values for its documented interval. [R1](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/wasmbench.config.json) [R5](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/docs/benchmark-workflow.md) [R17](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/analysis/statistics.go)

Do not synthesize confidence intervals to make old UI uncertainty fields non-null. Return the recorded uncertainty policy and reason when unavailable.

### 7.4 Multi-report aggregates

Preserve the current ability to combine compatible host-local sealed reports. Each aggregate returns all participating report/result identities through a bounded cohort resource, not one misleading representative report. [R8](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/src/lib/aggregates.ts)

Specify requested configurations, actual participants, omitted configurations, exact workload contract revisions, environment policy, compatible measurement definitions, weighting, and cohort digest. Require explicit policy for mixed versions or recipes within a track; never conceal them behind a single display-version label.

Reuse existing per-pass summaries from wasm-bench. Extract only the site-specific shared-cohort, weighting, and history-comparison logic. Golden-test current values before changing the storage path. A deliberate methodological correction receives its own analysis version; it is not hidden in a serialization migration.

For resampling, keep explicit replicate/cluster identities. Equal block numbers from two different report/pass IDs do not automatically represent a shared launch. Review current cross-workload correlation assumptions when merging reports. Resample actual independent units; use cross-workload clusters only when recorded design supports them. Until that method is defined, withhold unsupported aggregate uncertainty rather than invent it. The harness's median-bootstrap routine is not automatically a substitute for a weighted-geometric-mean confidence interval. [R8](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/src/lib/aggregates.ts) [R17](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/analysis/statistics.go)

Precompute popular overview scopes. Compute bounded custom cohorts on demand with concurrency limits and a method-aware cache. Never precompute every runtime subset or calculate a headline over only the current pagination window.

## 8. Artifact representation and inspection

### 8.1 Separate three states

The current code record can carry `size_bytes` when raw image export is unavailable. Model this explicitly rather than mapping the entire artifact to one availability flag. [R11](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/publish/code_pair.go)

Illustrative API descriptor, not an observed measurement:

```json
{
  "id": "artifact-id",
  "kind": "native-code",
  "measurement": {
    "metric": "native.code_size",
    "definitionVersion": 1,
    "status": "available",
    "bytes": 123456,
    "method": "engine-reported"
  },
  "content": {
    "status": "unavailable",
    "reason": "raw image export not provided"
  },
  "inspection": {
    "status": "unavailable"
  },
  "source": {
    "passId": "pass-id",
    "trialId": "trial-id",
    "configurationId": "exact-configuration-id"
  }
}
```

Only advertise content hashes, original-byte downloads, and function indexes when those resources actually exist. Distinguish exported native-image size, engine-reported size, serialized compiled artifacts, function ranges, and instruction-only code according to collector definitions. [R10](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/metrics/registry.go) [R11](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/publish/code_pair.go)

### 8.2 Reuse existing native-image extraction

The existing exporter verifies the sealed trial, checks image and module digests, decodes base64 into `.bin`, and emits metadata. Its run index embeds function lists, so it is not a bounded universal bootstrap. The downloaded deployment did not include code-inspection assets, despite the exporter being present in current source. [R18](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/export-code-inspection.mjs) [A1](wasm-fyi-audit-2026-10-05.json)

Move the reusable verified extraction behind the producer export contract. Decode once during export, store raw bytes by content hash, and publish a small descriptor. Put functions/sections in paginated or sharded indexes. Record extractor, architecture, target features, section kind, and backend.

Use per-function or bounded-region reads when metadata supports them. An ELF/serialized image offset must not be treated as a raw instruction offset without the correct mapping. Preserve original metadata for reproducibility.

Disassembly is an offline, versioned derivative, cached by image hash, target settings, and disassembler version. Do not invoke a runtime or disassemble an entire large image on a normal HTTP request. The latest V8 change already allows a long producer-side complete diagnostic pass for large modules; copying that cost into the public API would be inappropriate. [R2](https://github.com/JairusSW/wasm-bench/commit/a017c56fef370a54ffa33ca49ad9b6827e127cc4)

### 8.3 Chunking and original content

Use independently decompressible chunks for interactive sample arrays, timelines, function indexes, and diagnostic text. Target at most 256 KiB decoded per interactive chunk. Preserve the original file as an explicit download and record per-representation checksums/sizes.

For immutable uncompressed binaries, support validated byte ranges. For compressed content, either serve an independently compressed logical chunk or a correctly defined encoded-byte range; do not confuse decoded offsets with compressed offsets.

Retain original sealed evidence unchanged. Deduplicate bytes without mutating a shared hard-linked inode. A new stripped module or normalized disassembly is a derived artifact, not a replacement for the measured original.

### 8.4 Existing tool and parent bundles

Reuse the harness's content-addressed tool-cache identities and the coordinator's one-parent-bundle-per-machine/session hierarchy. Do not retransmit the same tools for each corpus or build a competing cache. [R5](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/docs/benchmark-workflow.md) [R13](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/docs/TOOL-ARCHIVES.md)

A local API may import parent archive parts once and serve their metadata and explicit downloads. Existing concatenated gzip archive parts are an archival transport, not an interactive function/chunk index.

Full replay capability is conditional: tools may be hash-pinned but not archived; compatible OS/native libraries may still be required; relocation can change configuration identity. Expose missing bytes and prerequisites instead of claiming every archive is hermetic. [R13](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/docs/TOOL-ARCHIVES.md)

### 8.5 UI

An artifact row shows name, kind, size source, content availability, short hash when available, target, and provenance. Overview is small. Samples, Functions, Disassembly, Timeline, Diagnostics, and Downloads are lazy tabs.

Do not prefetch complete binaries, trial arrays, parent bundles, or every function when a descriptor enters the viewport. Show size and encoding before explicit downloads. Retain performance values when inspection is unavailable.

## 9. Pebble indexes and incremental dataset revisions

### 9.1 Distinguish dataset revision from selection

Use `revision` for an immutable API dataset generation and `selection=current|previous` for the site's per-cell newest/previous-evidence policy. Map existing `s1`/`s2` URL values to selection. **The previous dataset publication is not necessarily the previous measurement of each cell.**

This also avoids confusing dataset revisions with the harness's runtime snapshot/checkpoint benchmarks. History point time, runtime source revision, report version, and dataset publication remain separate.

### 9.2 Key layout

Keys below are conceptual; implement versioned, unambiguous, order-preserving tuple encoding.

| Namespace | Value |
|---|---|
| `entity/type/id` | Immutable catalog facts or editorial revision. |
| `result/id` | Canonical summary and full provenance references. |
| `slice/id/result-sort-key` | Covering summary records for an immutable bounded selection shard. |
| `slice-by-config/id/config/workload` | Index for a supported configuration-focused view. |
| `history-segment/id/time/result` | Immutable indexed historical segment. |
| `revision/id` | Root references to selection/history/catalog maps and policies. |
| `map-node/content-id` | Bounded persistent-map nodes used by revision roots. |
| `cohort/id`, `aggregate/scope-hash` | Bounded metadata and computed aggregate. |
| `artifact/id`, `blob/digest` | Descriptor and local representation metadata. |
| `session/id`, `job/session/host/job/attempt` | Import/progress state; not an execution scheduler. |
| `current` | Active durable dataset revision. |

A complete corpus changes only affected current/previous selection shards and history segments. Reuse unchanged shards through a bounded persistent map of shard references. The top-level map must not be copied in full for every completed job; use fixed fan-out content-addressed nodes or bounded index pages with path-copying.

Build indexes for the shards once and share them across revisions. Do not write an entire `revision × all historical cells` copy on every update. Start with coarse corpus/metric/environment shards and split oversized shards by workload range.

This is application-level immutable state, not long-lived Pebble snapshots. Each HTTP request uses short-lived iterators and read handles. [P1](https://pkg.go.dev/github.com/cockroachdb/pebble/v2)

### 9.3 Query limits and sorting

Support a documented finite filter set. Catalog/category indexes select candidate workloads, then result indexes supply the relevant ranges. Store small covering summaries so a table does not need a full result fetch per cell.

Use opaque signed cursors bound to revision, filters, sort, last key, and schema. No iterator survives the request. Expired retained revisions return a clear error, not current data under an old cursor.

Stable catalog ordering is the default. For value sorting, use a supported index or sort the complete bounded candidate selection before pagination. Unsupported expensive sorts return a scope/limit error; sorting just the returned page is not global sorting.

Cap candidate scans, returned rows, decoded bytes, number of selected series/configurations, and custom analysis work. Record scanned/returned ratios for tuning. Never infer that a result not returned on this page was not measured.

## 10. API contract

All public endpoints below are under `/api/v1`. The paths are proposed, not existing routes.

| Endpoint | Returned scope |
|---|---|
| `/manifest` | Current revision, defaults, supported schemas/limits, small resource references. |
| `/revisions`, `/revisions/{id}` | Publication metadata and bounded referenced inventory. |
| `/runtimes`, `/tracks`, `/configurations`, `/machines`, `/environments`, `/metrics`, `/workloads` | Paginated registries and availability; exact details by ID. |
| `/overview` | Small aggregate cards and coverage for one frozen scope. |
| `/results` | Selected result summaries, readable objects or compact matrix. |
| `/results/{id}` | Detailed result/provenance and links, no whole-report embedding. |
| `/results/{id}/samples` | Explicit bounded recorded samples or chunk references. |
| `/aggregates`, `/cohorts/{id}` | Exact comparison method, membership references, and coverage. |
| `/history` | Bounded series with per-point configuration/contract/cohort identities. |
| `/reports`, `/reports/{id}` | Paged report descriptors; full recipe/context only on detail. |
| `/sessions/{id}`, `/sessions/{id}/jobs` | Bounded state/progress without embedded evidence inventories. |
| `/artifacts/{id}` | Small descriptor with independent measurement/content/inspection states. |
| `/artifacts/{id}/functions`, `/sections`, `/chunks`, `/content` | Paged metadata, bounded reads, or explicit original download. |
| `/features`, `/conformance` | Distinct measured probes and official suite evidence. |

A selected measurement query might use:

```http
GET /api/v1/results?revision=REV&selection=current&environment=ENV&scenario=steady&metric=time.wall&statistic=median_ns_per_operation&limit=100
```

The resolved measurement definition also includes source profile, denominator, collector, and method where applicable. All returned IDs resolve to exact records; display tracks are not a substitute for configuration provenance.

Paginate report metadata and return only references used by the current slice. Do not replace the bundled measurement file with an API that immediately fetches all 13,474 reports. Intern genuinely shared definitions/options fragments, not distinct recipes. Keep full host fingerprints, paths, tool inventories, and code record lists out of ordinary table responses.

Use explicit completeness information. Unreturned pages, pending fetches, HTTP errors, unmeasured combinations, and unavailable collectors are different states. Keep failed measured outcomes in catalog/coverage even when values are withheld.

For dense matrices, use response-local dictionaries and rows with values/intervals/status/result references. Preserve the source numeric precision. Individual metadata resources stay readable JSON. No base64 binaries in summary responses, no unbounded `include=all`, and no mandatory global dictionary.

OpenAPI plus JSON Schema owns wire types. Generate frontend types and validate producer packages. Keep schema version, source analysis version, and UI selection-policy version separate.

## 11. Publication and live updates

Retain existing `bench`, `bench-status`, `bench-stop`, `bench-resume`, and SSH workflows. Replace their data-publication sink behind an adapter; do not replace their execution state machine. [R5](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/docs/benchmark-workflow.md)

Proposed admin interface:

```text
POST /admin/v1/imports                 Submit job/export manifest
GET  /admin/v1/imports/{id}/missing    Paged missing-object inventory
PUT  /admin/v1/imports/{id}/blobs/...  Stream content with limits
POST /admin/v1/imports/{id}/commit    Validate/index/publish the complete job
GET  /admin/v1/imports/{id}           Bounded progress/error state
```

The unit of idempotency includes source session/host/job/attempt and export digest. Duplicate delivery of the same accepted attempt does not duplicate measurements. A retry's incomplete pass is never mixed with a previous attempt to fabricate a complete job. Failed/unsupported completed cells may publish; interrupted or infrastructure-failed jobs do not. Preserve the coordinator's exit-code meanings. [R5](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/docs/benchmark-workflow.md)

Publication order:

1. Stream staging files, enforce limits, verify content and source assertions, then install immutable content durably. Sync required file and directory changes on the configured filesystem.
2. Build/reuse catalog records, selection shards, indexes, history segments, and default aggregates under an unpublished revision. Persist portable manifests outside the database for rebuilding.
3. Verify references and visibility. Serialize publishers; synchronously commit the final revision marker and active pointer in a Pebble batch.
4. Only after durable commit, update the service's published-revision registry and notify clients that new data exists.

The database batch does not include separate filesystem writes; install content first. Pebble writes may be visible before the synchronous durability wait finishes, so public routes must consult the service's published registry, including direct-ID endpoints. Reconstruct this registry from validated committed revisions after restart. [P1](https://pkg.go.dev/github.com/cockroachdb/pebble/v2)

Browsers already using a revision remain pinned to it. A manual refresh or explicitly enabled live mode advances at a whole revision boundary, cancelling stale requests. It must not mix a new overview with an old workload matrix. A later lightweight event stream can announce revision IDs only, without streaming full records.

`--deploy` changes from committing every new dataset/archive and waiting for a frontend build to publishing data to this service. Keep the old export/Pages workflow as a transition and offline fallback. Do not couple application source deployment to every completed corpus.

## 12. History, feature coverage, and explanatory text

### 12.1 History is now multi-engine and can have partial coverage

The current site displays multiple engines across retrospective points; recent code connects recorded finite points while retaining partial-coverage markers and matched-workload change calculations. Do not revert to the former assumption that only Wago changes and all other engines are fixed. [L2](https://wasm.fyi/benchmarks/) [R3](https://github.com/JairusSW/wasm.fyi/commit/daf09f4810cd8229e521c462c93eae4292db306e)

Store target/source date, actual collection time, publication time, exact build, release association, reused-evidence identity, workload contracts, and coverage independently. A source snapshot is not automatically a published release. Reused evidence must not be counted as a new independent measurement.

Preserve recorded partial points, disclose their coverage, and calculate changes over explicit matched workload revisions. A connecting chart segment does not create intermediate measurements. Split or annotate incompatible host/method/contract changes. Do not present differences in unrelated workload averages as runtime regressions.

Use immutable time-partitioned segments reused across revisions. Return only selected series/window and a bounded number of plotted points, with level-of-detail metadata and raw access. Preserve gaps/events; do not impute samples.

### 12.2 Generate explanations as data

The live homepage describes merged host-local reports, while the benchmark latency caption still says one locked report. The public JSON manifest describes peak RSS as coming from a separate memory pass even though the current harness supports timing-pass RSS too. [L1](https://wasm.fyi/) [L2](https://wasm.fyi/benchmarks/) [L4](https://wasm.fyi/data/llm/index.json) [R13](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/docs/TOOL-ARCHIVES.md)

Generate cohort descriptions, source-profile explanations, uncertainty notes, and history roles from recorded policy fields. Keep editorial prose for introductions, not factual measurement provenance.

Feed HTML, tooltips, API descriptors, `llms.txt`, and machine-readable exports from the same interpretation metadata. Add semantic consistency tests, not merely tests that two outputs contain the same numeric values.

### 12.3 Features and optional evidence

Keep prepared corpus inventory separate from observed measurements and configured collection scope. Current collection excludes ordinary feature collection by default; absence is not unsupported. [R1](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/wasmbench.config.json) [R4](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/README.md)

Retain distinct evidence for compile-only probes, executed representative contracts, official suite cases, browser declarations, and plugin tests. Include suite version, configuration, counting unit, and collection time. Preserve existing memory/counter/profile/density/scaling evidence through generic descriptors even when a specialized visualization is not part of the first API release.

## 13. Frontend migration and deployment behavior

Introduce a typed API boundary and a bounded revision-keyed cache. Refactor `view-data.ts`/`model.ts` consumers to accept loaded scopes, preserving existing layouts, controls, URLs, formatting, and result interactions. Remove eager imports of measurements and large plugin/history datasets. [R14](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/src/lib/view-data.ts)

Load the manifest and selected overview, then the visible workload group or table page. History requests only selected series; drawers resolve their referenced results/reports. Abort obsolete requests and reject stale responses that no longer match the active scope.

Catalog-driven selectors replace hardcoded six configuration slots and two hosts. Preserve aliases for existing shared links. The fixed mappings being replaced are in the current projection code. [R19](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/view-data.mjs) New schema-known data should not require a UI code change, while an actually new visualization still may.

**Stage deployment rather than forcing a rendering rewrite.** First expose the Go API and migrate data reads while the current static frontend remains deployable. Then self-host the static assets and API under one origin. This is an API/data migration, not a reason to redesign the site.

For newly imported workload deep links, the Go server must handle recognized application routes and give correct 404s for unknown assets/resources. Serve a Svelte application shell for dynamic interaction and generate small crawlable reference pages from the current immutable revision. Do not leave stale prerendered measurement numbers behind after a data-only publication. Static SvelteKit output itself does not perform runtime data rendering; preserve that distinction. [P2](https://svelte.dev/docs/kit/adapter-static)

Keep canonical URLs, base-path behavior, sitemap, and existing `/data/llm/` discovery. Compatibility exports are bounded/paged or clearly marked bulk downloads. A versioned export refresh is not a second independent analysis implementation.

The first release may reuse precomputed current aggregate scopes. Before replacing interactions that support arbitrary runtime selections, implement the corresponding correct bounded calculation; do not silently return the default cohort under custom filter controls.

## 14. Transfer and resource budgets

These are proposed acceptance targets, not claims about current production performance. Budgets include dependent metadata requests, not only the primary results JSON.

| Operation | Target / limit |
|---|---:|
| Bootstrap manifest | <= 20 KiB compressed |
| Initial benchmark-page data | <= 200 KiB compressed across all initial data requests |
| Typical 100-result summary page | <= 50 KiB compressed |
| Artifact descriptor | <= 10 KiB decoded |
| Interactive sample/code/timeline chunk | <= 256 KiB decoded |
| Normal JSON response | Hard ceiling 1 MiB decoded |
| Results paging | Default 100, maximum 1,000 records subject to byte/scan limits |
| Report/archive/original binary | Explicit download; size and encoding shown |

Track JavaScript transfer, parse/decode duration, peak browser heap, and request count separately. A global 36 MB JavaScript payload fails even if its corresponding API endpoint is small. A 10 MB JSON index that compresses to 52 kB is still unnecessary decode/allocation work for a small page.

Use immutable revision/content URLs, canonical query keys, validators, short/revalidated current-pointer caching, and compression-aware ETags. Keep original-content hashes separate from encoded-response checksums. Test actual production content encoding rather than assuming precompressed files are served correctly.

Limit aggregate CPU, selected series, scanned keys, decompression bytes, upload size, and simultaneous requests. Use bounded in-memory and disk caches; no Redis requirement. Measure compression before adding a custom binary format.

## 15. Reliability, cleanup, and security

One process owns the database and serializes publication. Benchmarks run on worker hosts, not in the public API. Keep heavy indexing/compression outside active measurement windows when any hardware is shared.

Budget Pebble caches, memtables, decoded objects, and API caches together. Monitor compaction backlog, write stalls, free space, query latency, scan amplification, response sizes, import state, and stale open handles. Check dependency/version upgrades against actual restore tests. [P1](https://pkg.go.dev/github.com/cockroachdb/pebble/v2)

Backups include a consistent database checkpoint, portable revision/export manifests, and every referenced blob/representation. Pin required objects during backup assembly and retain an off-machine copy. A database checkpoint alone is not an artifact-complete backup. [P1](https://pkg.go.dev/github.com/cockroachdb/pebble/v2)

Garbage collection marks from retained revisions, active imports, backup leases, and active download/cursor retention. Use a grace period and quarantine before deletion. Never delete solely by modification time. Preserve historical provenance even when a documented retention policy removes an optional binary; expose its new availability state.

Authenticate admin imports, validate paths and digests, reject symlinks/path traversal, bound decompression, and escape diagnostic text. Never execute untrusted uploaded evidence. Avoid world-readable local tool/host paths in summary endpoints; preserve exact original paths in appropriately exposed evidence when required for identity.

Return safe structured errors for missing content, unavailable inspection, unsupported query scopes, stale revisions, and rate limits. Missing evidence is not zero. A partial import is not a published scientific result.

## 16. Implementation work packages

| Work package | Repository / files | Deliverable and acceptance gate |
|---|---|---|
| **A. Contract + current fixtures** | Both; source schemas and small sealed fixtures | Freeze current scope/identity semantics; add cases for multi-report history, one launch, timing RSS, size-only code, resumed jobs, and changed contracts. Record current byte baseline. |
| **B. Export v2** | wasm-bench `publish/report.go`, new export package/command, schema/pure-analysis boundary | Export bounded summaries and evidence manifests from verified source without changing existing numbers; retain legacy readers and independent analysis versions. Resolve package/module publication before direct imports. |
| **C. Pebble/content store** | wasm.fyi new `service/internal/store`, `artifacts`, `ingest` | One owner, portable manifests, immutable shards, incremental roots, idempotent per-job import, crash-safe visibility. Verify API dependency closure excludes SQLite. |
| **D. Core read API** | wasm.fyi `service/internal/api` | Manifest, registries, overview, results, reports, history descriptors, cursors, limits, matrix encoder. A table never reads the complete report inventory. |
| **E. Coordinator sink** | wasm.fyi `benchmark-worker.mjs`, benchmark coordinator/publisher, existing import/export helpers | Replace the completed-job destination, not scheduling/resume behavior. Preserve parent bundles, partial-attempt rejection, failure outcomes, and stop/resume semantics. |
| **F. Frontend + interpretation** | `src/lib/view-data.ts`, `model.ts`, `data/*`, route loaders, `ai-metadata` scripts | Lazy revision-bound reads, data-driven selectors, old-link aliases, metadata-driven labels, no measurement import in client JS. Validate deep links and crawler output. |
| **G. Artifact inspection** | Existing `export-code-inspection.mjs`, viewer, new artifact endpoints; harness native export | Binary content dedup; separate size/export/inspection states; page function metadata and read selected regions. No raw-image requirement for measured code size. |
| **H. Comparisons + history parity** | Site cohort/history policy modules and shared pure Go helpers | Preserve multi-report selection and exact point identity; version any statistical changes; review replicate clustering; no false CI from inner samples. |
| **I. Cutover + operations** | Deployment, admin CLI, backups/cleanup and CI | Publish without committing/rebuilding UI for data changes; restore verified offline; dependency, payload, security, and failure-injection tests pass. |

Work packages B/C/D can proceed against fixtures after A. F can be developed against the wire contract while storage proceeds. G need not block basic bandwidth improvements. H must be ready before cutover of affected interactive comparisons; precomputed scopes are a temporary bridge, not a permanent behavior regression.

Suggested directory boundaries:

```text
wasm-bench/
  publish/export/       Proposed verified site-v2 exporter
  analysis/            Existing analysis; extract dependency-light shared helpers
  metrics/             Existing canonical definitions
  protocol/            Existing evidence types; legacy remains readable

wasm.fyi/
  service/cmd/wasmfyi/
  service/internal/{api,store,artifacts,ingest,catalog,selection,maintenance}/
  schemas/
  src/lib/api/{types,client,cache,decode}.ts
  scripts/             Existing coordinator; new publication sink
```

Do not expand the first release into a distributed query engine, new scheduler, general remote benchmark execution service, or custom database format. Implement the finite queries the current site actually uses.

## 17. Tests and release gates

**Measurement parity:** exact values/intervals/status/reason zero; source units and unsafe integers; compiled-only versus executed; `size_bytes` with absent image; source profile for RSS; one peak per trial; one independent launch with many samples; changed workload input with same module; changed build under same track; mixed report provenance; average-RSS population counts; current versus previous per-cell selection.

**Collection integrity:** duplicate completed-job delivery; failure outcome accepted but incomplete attempt rejected; resume skips completed work; partial attempts never merged; parent tool bundle not retransferred; missing exact tools labeled honestly; configured harness pin differs from recorded producer revision.

**History/analysis:** multi-engine retrospective captures; release versus source markers; reused evidence not independent; partial coverage exposed; pairwise matched comparisons; no invented points; exact historical contracts retained; cluster identities not inferred from coincident block numbers; intentional method revisions separated from storage parity.

**Storage:** crash after each publication stage, missing/corrupt blob, disk full, concurrent publishers, durable pointer before visibility, direct-ID staging rejection, restart, revision-pinned cursors, persistent-map sharing, backup and restore, garbage collection racing with imports/backups/downloads, index rebuild from portable records.

**API/browser:** full selection sorted before paging; limits on scanned and returned records; no not-measured status inferred from an unrequested page; no global report preload; result drawer fetches only its referenced evidence; no full native image for a descriptor; source and generated explanation parity; deep links/base paths; cache validators; actual compressed bytes and browser heap measured in CI-capable browser infrastructure.

**Security/dependencies:** authenticated admin operations, no measurement execution from public paths, malformed cursor/path/schema handling, decompression quotas, safe diagnostics, and no SQLite driver in the API's linked dependency graph.

## 18. Definition of done

The Go/Pebble service publishes a completed corpus job without rerunning benchmarks, rewriting all history, committing its data to the website repository, or rebuilding the front end. Existing resumable collection continues to work. The UI and machine-readable interfaces select the same immutable revision and interpretation policy.

Normal navigation transfers bounded summaries and only the metadata they reference. Artifacts load progressively. A valid code-size measurement remains visible without pretending raw bytes exist. Historical comparison, measurement profiles, and archived-tool availability remain inspectable and explicit.

**The migration is complete when loading a small comparison no longer implies loading the entire experiment archive—and that reduction does not weaken the evidence model.**

---

## Sources and reproducibility

References below are pinned where the source is a repository file. Live page content may change after October 5, 2026. The companion JSON audit records exact inspected deployment IDs, sizes, compression settings, and access limitations.


- **R1** — [Site collection settings and harness pin](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/wasmbench.config.json)
- **R2** — [Harness inspected main commit and V8 diagnostic change](https://github.com/JairusSW/wasm-bench/commit/a017c56fef370a54ffa33ca49ad9b6827e127cc4)
- **R3** — [Site inspected main commit and partial-history display change](https://github.com/JairusSW/wasm.fyi/commit/daf09f4810cd8229e521c462c93eae4292db306e)
- **R4** — [Site README](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/README.md)
- **R5** — [Existing resumable collection, parent bundles, and publication workflow](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/docs/benchmark-workflow.md)
- **R6** — [Existing report importer and interned trial export](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/import-wasmbench.mjs)
- **R7** — [Existing projection receipt and transport exporter](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/lib/wasmfyi-export.mjs)
- **R8** — [Current multi-report aggregates and RSS average policy](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/src/lib/aggregates.ts)
- **R9** — [Harness report dataset, exports, and sealing](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/publish/report.go)
- **R10** — [Canonical metric definition registry](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/metrics/registry.go)
- **R11** — [Code size versus raw code export](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/publish/code_pair.go)
- **R12** — [Existing separate SQLite index and job queue](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/storage/index.go)
- **R13** — [Tool cache, archives, replay limits, and timing-pass RSS](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/docs/TOOL-ARCHIVES.md)
- **R14** — [Current eagerly loaded website data](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/src/lib/view-data.ts)
- **R15** — [Harness workflows, defaults, publication and safety](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/README.md)
- **R16** — [Harness module path and dependency declarations](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/go.mod)
- **R17** — [Per-pass summary statistics and independent-launch intervals](https://github.com/JairusSW/wasm-bench/blob/a017c56fef370a54ffa33ca49ad9b6827e127cc4/analysis/statistics.go)
- **R18** — [Existing verified code-inspection exporter](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/export-code-inspection.mjs)
- **R19** — [Current website projection and fixed configuration/host mappings](https://github.com/JairusSW/wasm.fyi/blob/daf09f4810cd8229e521c462c93eae4292db306e/scripts/view-data.mjs)
- **R20** — [Inspected successful deployment](https://github.com/JairusSW/wasm.fyi/actions/runs/37367026033)
- **P1** — [Pebble v2 documentation: batches, sync, checkpoints and compatibility](https://pkg.go.dev/github.com/cockroachdb/pebble/v2)
- **P2** — [SvelteKit static adapter documentation](https://svelte.dev/docs/kit/adapter-static)
- **L1** — [Live homepage read October 5, 2026](https://wasm.fyi/)
- **L2** — [Live benchmark page read October 5, 2026](https://wasm.fyi/benchmarks/)
- **L3** — [Live LLM navigation read October 5, 2026](https://wasm.fyi/llms.txt)
- **L4** — [Live JSON manifest read October 5, 2026](https://wasm.fyi/data/llm/index.json)
- **A1** — [Deployment and payload audit, including compact experiment](wasm-fyi-audit-2026-10-05.json)
- **A2** — [Compact 100-result prototype](wasm-fyi-compact-100-results-2026-10-05.json)
- **A3** — [Reproducible compact encoder and round-trip assertions](audit_wasm_fyi_payloads.py)
