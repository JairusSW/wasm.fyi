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

## Progress, stop and resume

```sh
just bench --id nightly --engines wago --workers 25%
just bench-status nightly
just bench-stop nightly
just bench-resume nightly
```

Ctrl-C also stops the supervisors and measurement subprocesses. Each session keeps an immutable `plan.json`, coordinator/host state, per-corpus results, sealed transport exports and trial logs under `.wasmbench/benchmark-runs/ID`. Completed corpora are skipped on resume. An interrupted corpus starts again from compilation; its partial attempt is discarded. This avoids combining partially measured passes. Artifacts remain cached under `.wasmbench/corpus-cache`, and remote machines retain content-addressed copies under their workspace's `corpus-cache`.

The plan locks artifact hashes, input hashes, source revisions, engines and measurement settings. Each host retains its workflow scripts for the session. Resume verifies those scripts, the cached inputs and prepared tool hashes. To change the selection or recipe, start another run. An active coordinator prevents a duplicate session. Resume stops any surviving supervisor belonging to an interrupted session before restarting it. Infrastructure errors leave the session incomplete for resume; failed/unsupported workload outcomes are sealed and retained without interactive repair.

Progress prints the machine, corpus and phase, followed by PASS / FAIL / UNSUPPORTED and measurements for each engine. Latencies are medians per operation. The RSS value is the mean of available whole-process RSS boundary measurements across compile, instantiate, first-call and steady; it is not a continuous time average. Missing measurements stay unavailable. Raw records preserve the measurement metric and collector.

Use `--launches`, `--samples` and `--timeout` to override the configured recipe. Call probes use one million operations and five steady samples for resolution. Failed cells never receive a successful headline timing. Completed sessions with failed cells return exit code 2 after retaining their evidence; infrastructure errors return 1 and interruptions return 130.

## Live site and deployment

Live local updates are enabled by default. Run `just dev` in another terminal; each completed corpus is transferred, seal-checked, appended atomically to the dataset, and projected into the UI. Existing corpora and other machines remain available. `--no-live` keeps the results without updating the site.

Each corpus's evidence links to its parent collection bundle. There is one parent bundle per machine/session, containing exact archived runner, analyzer, adapters, and high-level host/recipe metadata. Download its `index.json`, concatenate the listed gzip parts in order, verify its SHA-256, and extract the archive. Files are split below GitHub's single-file size limit. System libraries outside the harness archive remain explicit host prerequisites. Corpus evidence is delivered separately instead of retransmitting that bundle for every corpus.

```sh
just bench --id publish-example --engines wago --machines local,hub --deploy
```

`--deploy` builds and validates the resulting website, commits only the measurement datasets and parent bundles, pushes the current named branch, dispatches the existing GitHub Pages workflow for that branch, and waits for its verified result. Commit implementation changes first. Git/GitHub authentication and Pages permissions must already be configured. Progress includes the Actions workflow status and final deployment verdict.

```sh
just bench-export nightly /tmp/nightly-results.tar.gz
just bench-test
```

The results archive includes the plan, progress, per-corpus reports/logs and parent bundles; it excludes source checkouts, build caches and duplicate Wasm inputs.
