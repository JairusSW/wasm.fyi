# Benchmark commands

Build corpus artifacts explicitly, then measure them as often as needed. A measurement command never compiles a `.wasm` input. It builds and pins the host adapters and independent analyzer separately.

```sh
just setup
just corpus-build                         # all upstream, application, feature and call artifacts
just bench                            # all cached non-feature corpora, all six engines, local machine
```

On the first run, existing artifacts for the selected scope are adopted automatically. To populate the complete cache explicitly without compilation:

```sh
just corpus-cache --kind both
just bench --corpus qoi,applications/image-blur --engines wago,wazero
```

`corpus-build` accepts the same corpus selectors and feature scope. For example:

```sh
just corpus-build --corpus applications/image-blur
just corpus-build --kind features --corpus features/simd
just corpus-build --kind non-feature --corpus qoi
```

The pinned source builders validate their oracles before publishing the cache. Upstream source builds require the toolchains listed in `corpora/upstream/sources.json`; the WASI SDK is provisioned automatically. Application builds use Clang 22.1.8. Feature builds use the pinned wasm-tools and WASI adapter. Source compiler setup is separate from recurring measurements.

## Selection and machines

Selectors accept complete workload IDs, family prefixes, or the corpus name (for example `qoi`). Multiple selectors may be comma-separated or supplied with repeated `--corpus`. Every contract sharing a Wasm artifact stays in the same corpus job.

Supported benchmark engines are Wago, wazero compiler, Wasmtime Cranelift, V8 Turboshaft, WAVM LLVM and Wasmer Singlepass. V8 uses the pinned optimizing-only mode with Liftoff, tier-up and lazy compilation disabled. Sealed older reports keep their recorded backend identity.

```sh
just bench --kind non-feature --engines wasmtime,v8,wasmer-singlepass,wazero,wavm,wago
just bench --kind features --corpus features/simd --engines wago,v8
just bench --kind both --engines wazero --machines local,hub --workers local=25%,hub=25%
just bench --corpus applications/image-blur --engines wazero --machines bench@another-host --workers 2
```

The default worker budget is 25% of the logical CPUs admitted to each process, rounded down with a minimum of one. An integer requests that many workers; requests above the quarter-core budget are rejected. Every worker runs exactly one complete corpus job and gives each adapter one Go/Rayon/OpenMP thread. Linux workers also pin their controller and descendants to separate admitted CPUs. macOS limits concurrency but does not claim CPU affinity, exclusive cores, or publication-qualified host isolation. Parallel jobs can still contend for shared caches and memory bandwidth.

`hub` comes from `hosts` in `wasmbench.config.json`. Add other named SSH machines there, or pass an SSH alias / `user@host` directly. SSH must work noninteractively. Each remote host needs Git, rsync, Go, Cargo/Rust, tar, curl and (on Linux) taskset. If the configured local harness checkout is absent, the command fetches `harnessSource` at its exact configured commit. The command installs the pinned Node/V8 on SSH hosts, transfers the selected cached inputs and source revisions, builds native adapters on the destination, and retrieves completed corpora individually. It does not require a GitHub key on the destination. Wasmer's pinned SDK is prepared automatically; WAVM requires the pinned native SDK at the configured path or `WASMBENCH_WAVM_SDK`. Unavailable prerequisites fail during preparation before measurements start; no engine is substituted.

## Call latency

```sh
just bench --corpus mechanisms --calls-only --machines local,hub
```

This collects timing only and calibrates each accepted batch to at least 0.5 ms,
including warmup batches. Host → Wasm → host repeatedly invokes a typed identity
export. Wasm → host → Wasm invokes a guest loop containing one million typed
identity callbacks, then divides elapsed time by the number of callbacks.
Guest loop control and amortized outer host entry/return remain included.
If a batch is too short, the collector increases its invocation count and retries;
raw trial logs and calibration decisions are retained. GCC callbacks remain
opaque under optimization so identity calls cannot disappear. Older callback
history is labeled legacy because it timed one outer host call per callback.
The two directions are measured separately; no synthetic round-trip sum is used.

## Progress, stop and resume

```sh
just bench --id nightly --engines wago --workers 25%
just bench-status nightly
just bench-stop nightly
just bench-resume nightly
```

Ctrl-C also stops the supervisors and measurement subprocesses. Each session keeps an immutable `plan.json`, coordinator/host state, per-corpus results, sealed transport exports and trial logs under `.wasmbench/benchmark-runs/ID`. Completed corpora are skipped on resume. An interrupted corpus starts again from compilation; its partial attempt is discarded. This avoids combining partially measured passes. Artifacts remain cached under `.wasmbench/corpus-cache`, and remote machines retain content-addressed copies under their workspace's `corpus-cache`.

The plan locks artifact hashes, input hashes, source revisions, engines and measurement settings. Each host retains its workflow scripts for the session. Resume verifies those scripts, the cached inputs and prepared tool hashes. To change the selection or recipe, start another run. An active coordinator prevents a duplicate session. Resume stops any surviving supervisor belonging to an interrupted session before restarting it. Infrastructure errors leave the session incomplete for resume; failed/unsupported workload outcomes are sealed and retained without interactive repair.

Historical workers also restore unresolved failures from each reused capture's matching failure note. They preserve the capture bytes and do not execute it again. After a phase repair, only reasons for phases still marked failed enter the completion audit. Successful or unsupported captures ignore stale notes. A failed capture with a missing or mismatched note, or missing residual phase details, holds the integration audit for investigation; a documented workload timeout remains a retained outcome.

Progress prints the machine, corpus and phase, followed by PASS / FAIL / UNSUPPORTED and measurements for each engine. Latencies are medians per operation. The RSS value is the mean of available whole-process RSS boundary measurements across compile, instantiate, first-call and steady; it is not a continuous time average. Missing measurements stay unavailable. Raw records preserve the measurement metric and collector.

New latency runs collect ordered samples in one process per phase, in groups of five, with no warmup and a maximum of 35 samples. At each complete group, the latest ten samples (or the first five) must have standard deviation at most 5% of their mean, and the medians of the first and second halves of that window must differ by at most 3% of the mean. This is a repeatability stopping rule, not a statistical confidence guarantee for independent launches.

Every raw sample remains in acquisition order in the database. After two retained groups settle, a contiguous slow initial prefix may be excluded from the displayed distribution if each excluded value exceeds the settled mean by both 2 standard deviations and 3%. Later outliers remain. The summary records the retained start index, stopping reason, group size and cap. Headline latency is the median of retained samples. First-call and steady execution remain distinct phases. RSS is captured from the timing process, and native-code profiling runs once when timing has not supplied it.

The collector writes a compact `sampling.json` and publishes the policy with the ordered samples. The frontend does not derive independent-launch confidence intervals from these same-process observations. Old captures retain their original policy.

Explicit `--launches` or `--samples` selects a fixed recipe instead of adaptive sampling; `--timeout` changes only the timeout. Call probes use one million operations and five steady samples for resolution. Failed cells never receive a successful headline timing. Completed sessions with failed cells return exit code 2 after retaining their evidence; infrastructure errors return 1 and interruptions return 130.

## Live site and deployment

Live local updates are enabled by default. Run `just dev` in another terminal; each completed corpus is transferred, seal-checked, appended atomically to the dataset, and projected into the UI. Existing corpora and other machines remain available. `--no-live` keeps the results without updating the site.

Each corpus's evidence links to its parent collection bundle. There is one parent bundle per machine/session, containing exact archived runner, analyzer, adapters, and high-level host/recipe metadata. Download its `index.json`, concatenate the listed gzip parts in order, verify its SHA-256, and extract the archive. Files are split below GitHub's single-file size limit. For committed bundles, the website manifest gives each part an immutable GitHub `url`; download those URLs in order. The complete archives stay in the repository and results tarball, while Pages serves their metadata. `source-index.json` preserves the original index bytes and hashes. Uncommitted local bundles keep their parts beside the index. System libraries outside the harness archive remain explicit host prerequisites. Corpus evidence is delivered separately instead of retransmitting that bundle for every corpus.

```sh
just bench --id publish-example --engines wago --machines local,hub --deploy
```

`--deploy` builds and validates the resulting website, commits only the measurement datasets and parent bundles, pushes the current named branch, dispatches the existing GitHub Pages workflow for that branch, and waits for its verified result. Commit implementation changes first. Git/GitHub authentication and Pages permissions must already be configured. Progress includes the Actions workflow status and final deployment verdict.

```sh
just bench-export nightly /tmp/nightly-results.tar.gz
just bench-test
```

The results archive includes the plan, progress, per-corpus reports/logs and parent bundles; it excludes source checkouts, build caches and duplicate Wasm inputs.

## Shared Apple device reservation

Every Apple benchmark or profiler capture must acquire the user's shared reservation:

```sh
python3 ~/benchmark-lock.py --owner other-agent -- YOUR_COMMAND ARGUMENTS
```

`~/LOCK.md` reports status; reading `free` does not acquire ownership. Exit 75
means occupied: poll the file, wait, and retry the wrapper. Do not do heavy CPU
work while another agent owns the reservation. Never reclaim a reservation
without verifying both PIDs in `~/.benchmark-lock/owner.json` have stopped.

`scripts/shared-device-run.py` retries occupied reservations. With
`--repeat-slices`, it also resumes checkpointed commands that return 76 after
a bounded work slice. Apple historical workers and qualification runs yield
at the next workload boundary after 30 minutes, release the reservation, and
wait five minutes before attempting another reservation. Each workload has
an overall five-minute execution deadline. Workers on different hosts advance
independently. SDK builds may use multiple cores; measured execution uses one
worker, Linux CPU affinity, and Apple's available performance scheduling controls.

Before the next six-month historical campaign begins, clear the measurement
DB and old captured samples on all machines and servers. Qualification must
finish before that reset and campaign launch. Repeated source revisions use
linked captures from the same backend, machine, corpus contract and sampling
policy rather than collecting duplicate measurements.

Generate the frozen source inventory with:

```sh
node scripts/plan-six-month-history.mjs CAMPAIGN_DIRECTORY [ANCHOR_ISO_TIMESTAMP]
```

The planner covers all registered engine families and all three hosts. Weeks
end Sunday at 06:00 in `America/New_York`, including daylight-saving changes;
the current partial week ends at the frozen anchor. It selects the latest
eligible release published within each interval, or the default-branch commit
closest to its end when there was no eligible release. Wago uses beta releases.
Resolved full commit hashes determine reuse entries. Missing sources and
unresolved release provenance remain explicit gaps, rather than silently
substituting another source. The inventory is planning data, not proof that a
runtime was built or that its measurements completed.

The history window bounds snapshot dates. A dormant project's source commit
can predate that window; its age is limited to one year relative to the weekly
snapshot. Require an eligible prior commit to establish that the project
existed at that time, then compare earlier and later default-branch commits
within the frozen anchor. Identical selected hashes share measurements. This
keeps quiet projects in the inventory without inventing snapshots before a
project existed.

Historical sweeps include only non-feature corpora. Feature compatibility and
feature performance are collected only for the latest version of each runtime
and backend; they do not run for historical weekly pins.

## Wizard SDK JSON transport

The adapter uses `scripts/lib/wizard-json.mjs` to patch the pinned Virgil JSON
reader and renderer. The upstream reader accepts only signed 32-bit integers,
does not decode string escapes into their values, and does not handle all JSON
Unicode escapes. Its source-literal renderer also uses escaping that is invalid
in JSON. Go's default encoder exposes this on unchanged workload metadata such
as `Calls & memory`, which it sends as `Calls \u0026 memory`.

Keep the default Go transport and the original corpus metadata. The adapter
decodes JSON strings, combines Unicode surrogate pairs, rejects malformed
escapes, and renders JSON strings correctly. It preserves wide and fractional
provenance number tokens exactly as strings; integer control fields retain their
numeric types. Source-layout guards fail closed if the pinned parser changes.

The October 10 qualification passed 14 actual SDK parser/renderer cases and
one verified sample of compilation, instantiation, first call, and steady
execution through the unchanged Go client. A separate production SDK build
passed the same four phases without the private test hook. Hub also reproduced
the original default-encoder failure and qualified all three Wizard modes after
rebuilding their SDKs. These proofs do not substitute for the full corpus sweep.

Archive old SDK artifacts and their build receipts before promoting the fix.
Rebuild each platform's SDK and refresh its artifact hashes consistently; do not
reuse an old build receipt with a new binary. Confirm the helper used by the
actual build, not only a staged copy, and record the generated parser and final
SDK artifact hashes. Qualification must replay the production full-contract
prepare request on a fresh process, including Go's default Unicode escapes. Repair failed phases while retaining
successful phase values, samples, and resource measurements. All qualification
execution follows the same device reservation and host exclusion rules as the
benchmark workers.

### GraalWasm ordered vector capability (2026-10-10)

The Java embedding already implements `exact_vectors` using ordered cases,
input writes and exact output checks outside the summed call timers. Its
`describe` response previously omitted `can_run_vectors`, causing the harness
to reject BLAKE3 before executing it. The adapter now advertises that existing
capability and separate compilation/instantiation. It does not advertise vector
phase-barrier callbacks, which the embedding does not implement.

Cached SDK recovery should recompile only the Java helper after the current
family finishes, then retry the rejected workloads. Keep completed measurements;
do not relabel zero-sample integration rejections as engine incompatibility.
Descriptor change is implemented; runtime recovery remains pending validation.

### V8 optimizing tier and compiler identity (2026-10-10)

An optimizing-only tier lock does not prove the Turboshaft compiler pipeline.
The pinned Node.js 22 source defines `turboshaft_wasm` as false and selects
TurboFan unless that flag is enabled. `%IsTurboFanFunction` checks the
optimizing tier, not which compiler pipeline produced it. Older captures made
without the flag must retain their original measurements and must not be
displayed as proven Turboshaft captures.

Use the explicit `--turboshaft-wasm` flag when the pinned runtime exposes it.
Newer pinned sources can remove that flag and invoke Turboshaft unconditionally;
require evidence from that exact source before accepting its default. Do not
pass a removed flag or infer the compiler from a version threshold. Record
the compiler policy in the effective configuration and distinguish corrected
Turboshaft configurations from legacy `optimizing-only` descriptions.

Reuse the installed SDK. Previously captured workloads need another measurement
only when the original compiler was wrong. Confirmed Turboshaft captures can
receive corrected metadata while preserving every sample and resource value.
The corrected configuration must be selected by the latest/history projections
even when its original capture timestamp is unchanged. Source-bound policy/parser tests and SQL latest/history tie-selection tests passed.
Cached harness/controller correction is queued behind the current host lease;
the durable correction ledger separates wrong-backend remeasurement from
metadata-only promotion, preserves original captures, and retries pending
original jobs after their normal completion. The pinned Node22 implementation
can still fall back from Turboshaft to TurboFan if Turboshaft compilation fails;
the backend records the explicitly requested pipeline, not per-function
compiler attribution.

### Apple source-fetch recovery and zwasm staging (2026-10-10)

Historical `git exited 128` startup failures often came from GitHub DNS
resolution failures. These are acquisition failures, not runtime compatibility
results. Retry the exact planned source after connectivity recovers; completed
pin receipts remain the skip criterion, rather than prior attempted slots.

The zwasm private harness can contain generated `zwasm-link-objects` with an
unreadable archive symbol table. Exclude that generated directory from harness
Git staging. Keep source files, source identity, and installed artifacts intact;
the exclusion does not require repeating completed measurements.

Capacity checks distinguish the free-space reserve from estimated cold SDK
growth. A cache exemption requires the exact source and configuration plus
matching hashes of the installed controller and runtime files. Perform those
file checks under the shared device/build reservation, before measurement.
Capacity-blocked source/configuration pairs remain pending; an attempted slot
or a family runner's zero exit status alone does not prove capture completion.

### Latest feature sweep repairs (2026-10-10)

Use the source revision already fetched for the latest weekly snapshot. Run
one-sample feature compatibility before adaptive feature performance for each
configuration. Historical main-corpus work stays parked until missing bindings
and feature adapter defects are resolved. A processed-configuration counter is
not a coverage proof: check the source-bound case ledger and retained failures.

Cached V8 source trees may have unneeded working-tree files removed. Compiler
policy qualification can read the exact pinned Git blob while preserving the
installed Node hash and source revision. Controller-only rebuilds need the
prepared toolchain environment, including Go's PATH, and may use multiple cores
under the exclusive host lease. Measurements remain single-core. A binding
upgrade failure holds that configuration while other runtimes continue.

Wazero's redundant oracle call on its retained instance can consume destructive
fixtures between sample groups. Remove that extra call while retaining each
sample's fresh-instance validation. The regression tests cover repeated groups
of destructive instantiate, first-call and steady samples and incorrect results.
Repair only failed phases with their actual new capture timestamp; preserve
successful phase bindings and original failed records.

An adapter's missing host-profile declaration does not prove the runtime lacks
the feature. In particular, latest V8's JSPI adapter support must be repaired.
Explicit backend compiler rejections, such as Wasmer Cranelift's tail-call
operators, need source-bound classification and retained original diagnostics.
