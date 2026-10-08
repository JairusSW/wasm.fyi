# API frontend migration

The homepage and benchmarks default view are generated from the published
database into HTML, with only headline comparisons, display metadata and one
25-workload table page. Hydration reuses this prepared scope without measurement
API calls. Other scopes and selected details use the API. The browser retains fetched
cells separately for each host and current/previous selection. Requests for the
same revision and scope share one fetch; canceling one consumer does not cancel
another. Completed responses enter the bounded revision cache, and affected
views react to the new data. Host changes preserve the other host's cells and
keep controls mounted while missing data loads. All views pin one
immutable dataset revision. Homepage comparisons, workload tables, workload details, feature views,
history and result drawers use this revision. Existing `s1` and `s2` URLs select
current and previous measurements; they do not select the previous publication.

`just dev` starts Go, Vite and Caddy at http://localhost:8080. The API database is
selected by `WASMFYI_DATA_DIR`, then the private `.wasmfyi/local/data-directory`
file, then `.wasmfyi/local/data`. Keep this directory across restarts. The local
publisher token remains in `.wasmfyi/local/admin-token`.

Production builds no longer import a global measurement dataset into JavaScript.
`just serve-local` prepares the bounded default pages before building. Prepared
files are reused for the same revision, and regenerated when the publication
changes. Page preparation is an offline database read while the server is stopped;
it does not collect new measurements or complete the waived full audit.
The homepage sample count sums producer `recorded_samples` across current
timing-pass compile, instantiation, first-call and steady summaries on both
physical hosts. It includes multiple samples per launch and excludes memory
diagnostics and previous selections. Zero is valid; missing source counts remain
unknown. This scalar is generated offline alongside the page, without sample
arrays in the browser.
The initial data is serialized into HTML and route data, outside JavaScript chunks.
Server-side prepared result selections support complete filtering, ordering,
pagination and totals without exposing the whole selection to the browser.
Legacy JSON remains available to parity tests and offline collection tools.
The workload catalog is bounded metadata; reports, launch samples, report files,
native bytes and disassembly are requested only for selected details. Table
filtering and sorting happen before pagination. Complete API comparisons and
group totals never use the returned page as their population.

The additional-data API includes `/api/v1/corpus/{id}` and
`/api/v1/inspect/{id}` for an exact workload contract digest. Both require
`environment`, explicit `tracks` (a JSON array), and optional host membership,
selection and revision. `/api/v1/corpus?workload=...` selects a logical workload
across its recorded contracts. Corpus summaries include eligibility and exact
configuration references; they exclude trial arrays and producer recipes.
Inspection discovery keeps measured size separate from exported content and
provides byte/function/disassembly resource links only when available. Function
pages and disassembly windows retain their existing bounded endpoints.
History uses one selected `/api/v1/history/timeline` request with `from` and
exclusive `until`, explicit tracks, metric and revision. The benchmarks history
section loads when it enters the viewport. `just serve-local` also prepares a
revision-specific Pebble history index under `page-seeds/history-index`, joining
canonical summaries to their publisher-declared dates. Requests select the date
window, host, tracks and metric from this index instead of loading the complete
historical corpus. The same index stores current reference populations for each
history metric and physical host, using the existing host selection and admission
policy. Neither those populations nor historical summaries are preloaded by the
browser. Collection times, exact contracts, eligibility, build roles
and reused-evidence identities remain unchanged. The index is disposable and
rebuilt when the revision changes; incomplete builds never replace a complete
index. Selected reads retain scan and decoded-memory ceilings, and ordinary
JSON responses retain their 1 MiB ceiling.

The imported default view measured 33,276 bytes (homepage data) and 78,706 bytes
(benchmarks data) with local Brotli quality 5. Complete prerendered HTML measured
37,855 and 90,712 bytes respectively. These are local compression measurements,
not live transfer guarantees. Decoded seeds are 191,832 and 740,374 bytes. The
seeds contain no trials, launch-median arrays, history or artifact bytes.

## Publication prerequisites and remaining parity work

The retained migration completed 29,380 reports and 176 metadata files in
`.wasmfyi/local/snapshot-data`, with revision
`331cedf5a2996527209b79a35a521533adfbb18ec44bd65ff5bea52b8e24ba27`.
Retained producer projections carry integrity checking, not independent source
recomputation. The full final audit was cancelled at the user's request before
completion; an audit pass is not asserted. Original sources remain available. A subsequent metadata correction resolves
weekly producer report hashes to website report IDs before translating them to
imported report IDs. It restores six-engine source history and legacy release
bindings without modifying measurement catalogs, observations or selections;
original jobs and dataset revisions remain available.

`just serve-local` serves the production build and this store through Go and
Caddy at http://localhost:8080. It uses read-only HTTP serving with root checks,
deferring the complete startup inventory and graph audit. Content reads retain
hash checks. Browsing and downloads work; publication and maintenance writes are
disabled. The ordinary serving command retains full startup validation.

The harness export release must incorporate its current scientific changes and
use a proper pinned package/release arrangement. The earlier export feature branch
is not a substitute for the newer harness main revision. Preserve configured
harness pins separately from actual producer revisions.

Compiler-inclusive C AOT average RSS is unavailable until its full process-tree
measurement policy is exported and supported. Detailed reports for the sum of
both call directions are unavailable; ordinary call-direction reports remain
scoped to their exact workload. Historical comparisons retain matched contract
and analysis identities, with unavailable uncertainty. The current timeline
policy uses current shared contracts as its reference population; historical
contract changes require additional parity review before
production cutover.

Official plugin-suite interpretation is not yet projected into the existing
feature UI from the conformance API. It remains separate from benchmark feature
contracts. Do not infer suite success from performance results.

Core browsing now uses the retained store locally. Scientific parity limitations
above remain recorded; VPS deployment and full verification have not completed.
