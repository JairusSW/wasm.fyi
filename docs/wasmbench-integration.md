# wasm-bench data integration findings

The visual UI and displayed data providers are unchanged; hosting links now support the GitHub Pages project path. This document maps verified harness
exports onto the existing data/model boundary; it does not implement that wiring.

The inventory below records the initial exploratory import. Current two-host application, feature, worker and weekly-history collection is described in [features-and-history.md](features-and-history.md); [integration-audit.md](integration-audit.md) records the remaining view wiring. The current snapshot index is the authoritative report inventory.

## Gathered data

`data/wasmbench/index.json` contains compact, verified report projections. Each
referenced JSON contains the same projection plus raw trial samples. The source
report SHA-256 is its `id`; the projected JSON has different bytes. Source reports
and run evidence remain in the sibling harness checkout.

| Source report | Run | Launches | Configurations | Workloads | Additional evidence |
| --- | --- | ---: | ---: | ---: | --- |
| `five-configurations-lifecycle-graph-v18` | `five-configurations-timing-board-v2` | 1 | 5 | 5 | Matched memory and native code passes |
| `extra-adapters-v2` | `extra-adapters-timing-v2` | 3 | 8 | 2 | Matched process peak RSS |
| `five-configurations-composite-v3` | `five-configurations` | 3 | 5 | 5 | Timing only |

The first and third reports cover Wago/Railshot, wazero/compiler,
Wasmtime/Cranelift, Wasmtime/Winch and V8/production-default-tiering. The second
covers wasmi, WAVM, wasm3, WasmEdge, SpiderMonkey, JavaScriptCore, V8 shell and Deno.
There are 13 configuration IDs and seven distinct workload IDs across these
reports. They are separate experiments, not one 13-runtime comparison.

All three are local exploratory measurements on Apple M4 Max, Darwin/arm64.
The five catalog-imported workloads are tiny, recursive Fibonacci, dispatch,
matrix multiplication and SHA-256. The additional engines ran the harness core
identity and sum workloads. They do not populate the site's synthetic 1,284-workload
corpus, x86/Ampere machines, SQLite/application entries or proposal corpora.

`report-catalog.json` inventories 300 local report datasets, including 153 timing
measurement candidates. Inventory entries are explicitly **unverified**: many are
alternate renderings of the same run, diagnostic passes or different report types.
The three index entries were separately verified before export.

## Refresh the gathered exports

```sh
node scripts/import-wasmbench.mjs
```

`wasmbench.config.json` points to `../../Tools/wasm-bench`, resolved relative to this
site. For old renderings, `rebuild: true` generates a new report in a temporary
directory from sealed `raw`, `raw-memory` and `code/raw` evidence with the current
harness. It leaves original reports untouched. The script invokes
`go run ./cmd/wasmbench verify-report --dir ...` for every report and checks the
source data digest again before writing the projections.

Pass explicit report directories to gather different snapshots:

```sh
node scripts/import-wasmbench.mjs ../../Tools/wasm-bench/reports/extra-adapters-v2
```

Explicit paths resolve relative to the command's working directory and replace
the index. `WASMBENCH_ROOT` overrides the checkout; `WASMBENCH_BIN` can select an
absolute path to a trusted current controller instead of `go run`. Go and the
harness are required only for gathering, not for the existing frontend build.
Correctness-only/non-timing reports and publication receipts requiring operator
key verification are rejected. No measurements were rerun for this investigation.

## Existing UI data mapping

Keep the Svelte page/component markup and CSS. Replace data providers and derived
computations behind them, with minimal data-bound text updates for factual labels.

| Existing seam | Harness field / join | Conversion and handling |
| --- | --- | --- |
| `data/runtimes.ts::CFG`, `CB` | `manifest.lock.runtime_configurations` | Preserve configuration `id`, `description.runtime`, `runtime_version`, `backend`, embedding and effective settings. Keep existing swatches. Do not identify a backend by runtime name alone. |
| `data/runtimes.ts::MACH` | `manifest.host` | Use actual host metadata and policy. No architecture scaling factors; an unmeasured machine is unavailable. |
| `data/snapshot.ts::BENCH`, `ALLB` | `manifest.lock.workloads` | Preserve full workload ID, family, SHA-256, ABI, export, arguments, reset, license and provenance. Join `artifact_structures` by SHA-256 for actual Wasm size. |
| `model.ts::benchVal` | `summaries` keyed by runtime, workload, scenario and profile | `compile → compile`, `inst → instantiate`, `first → first-call`, `steady → steady`. Read only eligible timing medians. Convert ns/operation to ms/operation by dividing by 1e6. Remove size-derived estimates and hash noise. |
| `benchVal(..., 'rss')` | `memory_stages`, with metric `process.peak_rss` | Bytes → existing MB unit, using an explicit consistent divisor. Preserve the memory pass identity. Whole-process lifetime RSS is **not** the existing UI's phase RSS increase. The label/tooltip must reflect this domain. |
| `benchVal(..., 'code')` | `code_records` | `image_bytes` is a mixed compiled image containing wrappers/data; it is not guest function code. Keep unavailable/unsupported states. Do not populate stubs, metadata, active or cumulative columns from this single value. |
| `model.ts::ratio`, `absOf`, `leader` | Eligible shared workload cells in a selected report | Compute aggregates from measured cells with one explicit cohort and weighting policy. Corpus-balanced and workload-balanced aggregation need real family membership. Bootstrap independent launches for aggregate uncertainty; never treat missing CI as zero uncertainty or proclaim a clear leader from one launch. |
| `components/Drawer.svelte` | Summary `launch_medians`, raw `trials`, lock/workload metadata | Use actual launch points, CI bounds, outcomes, reasons and source IDs. Existing drawer geometry can remain. Remove generated points, fake commits/hashes, invented p90/CV and nonexistent `wbench` replay commands. |
| `ScopeBar` / `state.svelte.ts` | Imported report IDs and host/config IDs | Populate existing selectors and codecs from data; the current `s1/s2`, `m1/m2` and `A…G` identities are fixtures. Keep the same controls and URL behavior. |
| Detail route `entries` / `load` | Imported workload IDs | Prerender all measured workload IDs; preserve slash-containing IDs and the existing detail-page layout. |
| Detail memory timeline / code breakdown | `memory_timelines`, raw observations, code evidence | Render only reported series/breakdowns and their declared domains. Stage peaks alone cannot reconstruct a timeline, retained-memory value or phase delta. Leave unsupported views unmeasured. |
| `/compare` phase model | Per-workload timing summaries | Feed measured phase vectors into the existing estimator. Cached-load/tier-up values remain unavailable unless recorded. The estimator stays labeled a model, not a measured lifecycle total. |
| `SNAPS`, `otSeries`, `/history` | Comparable separately locked experiments | Imported reports do not establish a comparable 16-week time series. Preserve the chart UI with unavailable series; no interpolated or hash-generated trends or change reports. |
| `data/features.ts`, proposal pages | Adapter declarations and dedicated feature evidence | Declarations are not conformance results. These reports contain no proposal benchmark or spec-test suite results. Keep those cells unknown/not measured; do not infer unsupported from absence. |

## Schema and eligibility details

The harness export is `publish.Dataset`, schema 1, in `publish/report.go`.
`experiment/types.go` defines manifest, lock, configurations and raw trials.
`analysis/statistics.go` defines stage summaries; `analysis/latency.go` owns
headline timing eligibility. `publish/memory_stage.go` owns paired memory joins
and memory domains. `publish/code_pair.go` defines mixed native image records.
`publish/artifact_structure.go` provides validated artifact structure and size.

A successful trial alone is not enough for a timing value. Require
`latency_status == "timing_pass"`, `profile == "timing"`, and a non-null median.
Use outcome counts independently of latency eligibility so partial failures stay
visible. Preserve unsupported, incorrect result, adapter failure, timeout and
missing states through an explicit mapping to the site's status vocabulary.
The extra-adapter report includes wasm3 instantiation cells without latency.

The one-launch report has null confidence bounds. Three-launch reports can have
bootstrap bounds while `stability` remains `not_established`; interval availability
is not proof that warmup converged. These runs have zero discarded warmup samples,
unlike the site's fixed five-warmup/ten-process/thirty-iteration copy.

## Suggested implementation order

1. Define a versioned frontend snapshot adapter and fixture tests for units,
   missing/failed cells, exact configuration identity and withheld intervals.
2. Replace runtime/machine/corpus providers and `benchVal`, keeping current UI
   markup, tables, controls, bars, navigation and CSS.
3. Replace aggregate computations and drawer evidence. Update only factual
   labels/settings/counts that currently assert synthetic values.
4. Feed measured detail/compare data; preserve unavailable states in history,
   proposal, memory timeline and code-breakdown views until dedicated evidence
   exists. Validate deep links and static prerendering without redesigning pages.

Validation performed for the gathered exports: harness report recomputation and
verification, source data digest checks, and rejection of a deliberately corrupted
report while preserving the prior index. The original UI layout and styles are preserved; the site and projected evidence are validated through the just workflow.
