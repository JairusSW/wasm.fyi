# Feature measurements and weekly history

The existing pages and charts retain their presentation and consume verified measurements. Representative feature contracts replace fabricated spec-test counts; compile-only probes, unsupported cases and missing collectors remain explicit.

```sh
just bench-build
just features-build       # needs wasm-tools 1.260.0; downloads a SHA-pinned WASI adapter
just features-test        # corpus digests and independent admission regression checks
just features-check       # exact oracles, including explicit experimental configurations
just features-collect
just features-collect-hub
just threads-collect
just threads-collect-hub
just history-plan
just history-collect
just history-collect-hub
just verify
just deploy
```

`just refresh` runs on demand; there is no daily or weekly cron. It collects applications, feature performance and official conformance evidence on the Mac and `hub@hub`, validates the evidence, and builds the site for GitHub Pages. Engine builds must come from published releases. Nightly, main and dirty engine builds are excluded. Released prereleases retain their prerelease identity.

`just history-plan` resolves an initial eight Wednesday snapshots, then catches up every missed Wednesday from the oldest retained snapshot. The cutoff is Wednesday 00:00 UTC: choose the latest release published at or before that instant, never a nearby main commit. Publication timestamps select releases; tag commits establish source identity. Node uses the newest published version in the highest released major; it retains the locked Turboshaft and Liftoff modes. Node and Firefox upstream indexes expose day precision, which is recorded. JavaScriptCore standalone release provenance and WAVM non-nightly releases remain explicit gaps.

`just history-collect` currently collects released Wasmtime and Wago **conformance** history. It records all fourteen engines in the plan, with explicit uncollected runner gaps, and exits nonzero when coverage is incomplete. It does not reconstruct performance history for those engines. Old source-revision history remains archived and is not relabeled as Wednesday release evidence. Actual collection dates are never backdated.

## Official conformance suites

`just conformance-plan`, `just conformance-collect`, `just conformance-collect-hub`, and `just conformance-publish` use checksum-sealed reports. Official WebAssembly 3.0 `.wast` scripts run through the released Wasmtime CLI's native WAST interpreter in Cranelift and Winch modes. Component Model WAST includes async, linking, resources, validation and values. The unmodified official WASI test runner checks its fixture output, exit, environment and preopen oracles. Released Wago plugins run their shipped official Component Model and Wasmtime regression fixtures against the released Wago engine.

Each report pins the suite commit, file inventory, engine release, binary or source hashes, flags, tool dependencies and raw outcomes. Counts distinguish whole WAST files, WASI cases and Go leaf subtests. Failed assertions, parser errors, timeouts, expected-failure skips and runner errors remain explicit. Official conformance never enters execution performance averages. The public index is `wasmbench/conformance/index.json`.

The default collection covers qualified Wasmtime lanes and Wago Component Model. `WASMBENCH_CONFORMANCE_LANES` can select `wago-core` with the pinned official reference interpreter in `WAGO_SPEC_INTERPRETER`; `wago-wasi` requires Linux because the released plugin's suite runner is Linux-only. A successful process with zero tests is a runner error. Other engine official-suite runners are uncollected, not claimed unsupported or passing.

## Original corpus

`corpora/features/generator.mjs` produces 104 artifacts with 232 exact contracts across all 25 feature families represented by the website. Most execution cases vary through 1, 64, and 4,096 guest operations. Memory-bandwidth cases use 64, 4,096, and 65,536 bytes; compilation cases vary function/global/canonical-builtin counts. Scalar baselines are explicitly tagged and excluded from support claims. The corpus is original MIT code; adapted Preview 2 commands also contain the pinned Wasmtime command adapter and its license.

Coverage includes integer and floating arithmetic; aligned, unaligned, narrow and growing memory; branches, direct/indirect calls and tables; bulk-memory operations; references; multi-value; five SIMD variants; deterministic relaxed SIMD; GC structs, arrays, i31 and subtype casts; Memory64; exception throw/catch/rethrow; direct and indirect tail calls; multi-memory; constant initializers; native JS string builtins; atomics; proposal continuations; five host-interface workloads for each WASI preview; nested component calls; canonical u64 crossings; resource destructor lifetimes; and asynchronous component compilation at three structural sizes.

The seven ordinary engine configurations are supplemented by `wasmtime-component-async`, built with `component-async-probes` and explicitly enabled async component validation. Where Node accepts `--experimental-wasm-wasmfx`, `v8-wasmfx` runs the continuation workloads. These are separately named configurations, never treated as a default engine. JS string support is checked by constructing and executing a builtin module with imported string constants, not by Node version alone. The default Wasmtime adapter is built without GC/threads/async Cargo features; its unavailable cells describe that build, not the entire Wasmtime product.

Async component cases measure compilation only. They do not claim future/stream execution support. The continuation cases cover construction, repeated allocation/resume, and work inside a resumed continuation; suspend/resume scheduling and arbitrary continuation signatures remain outside this corpus. Exact command outputs and result codes check WASI host interfaces; the random-get case does not claim entropy-quality testing. These workloads test representative behavior and performance, not complete specification conformance.

`threads-workers.wat` separately tests imported shared memory with real Node workers. All 32 combinations of contended/disjoint counters, 1/2/4/8 workers, and 1,000/10,000/100,000/1,000,000 operations per worker run on each host. Every configuration has three independently created worker groups, one warmup and three verified batches. Timing includes dispatch, concurrent guest increments and completion messages; worker startup, compilation and oracle checks are excluded. The raw samples and this scope are recorded explicitly. This profile measures Node's worker embedding; it does not imply that every adapter provides a comparable worker API.

Feature timing uses three independent launches and three samples by default, with zero warmup for the component contracts. Memory is a separate pass; native code extraction is a separate compilation pass. Standard application collection retains its configured defaults. Dispatch inputs can override launch/sample counts. Hosts record their actual toolchains, ISA, engine inputs and uncontrolled scheduling/frequency policy. Guest `units_per_invocation` is distinct from the harness's measured invocation count; consumers must use the former before presenting throughput per guest operation or byte.

## Data endpoints

- `wasmbench/index.json`: schema 2 inventory with SHA-256 references to compact summaries and full raw JSON evidence. Fetch each entry's `projection`, verify `projectionSha256`, and then follow its `evidence` and `evidenceSha256` when raw samples are needed.
- `wasmbench/feature-support.json`: exact case outcomes grouped by host and configuration. Each case retains its report/evidence digest. Scalar baselines do not count. A targeted newer run can fill a case only when all pinned runtime inputs and the description match; different engine builds never combine.
- `wasmbench/threads/darwin-arm64.json` and `wasmbench/threads/linux-x64.json`: digest pointers to complete worker samples.
- `wasmbench/history/weekly.json` and `wasmbench/history-hub/weekly.json`: eight target dates, exact Wago SHAs, commit dates, actual collection dates, report digests and a fixed comparison-engine baseline. Each directory has its own schema 2 snapshot index.

Unsupported configurations retain explicit reasons. Incorrect results, traps, crashes and timeouts remain failed outcomes. Feature/history collection can finish an intact sealed bundle containing such outcomes, while ordinary application refresh remains fail-fast. Any failed launch withholds that cell's headline latency and interval, including when another launch succeeded. Invalid artifacts, changed checksums, absent bundles, transport failures and build failures stop publication. A green collection/deployment workflow means evidence integrity passed; it does not mean every runtime passed every feature.

## Historical interpretation

History is a retrospective experiment: weekly Wago commits run **today** on the same pinned current corpus against fixed current comparison engines. `targetWeek` and `revisionDate` never replace `collectedAt`. The baseline's versions, input digests and report are preserved alongside history, independently of daily snapshot retention. Historical results are descriptive comparisons on the recorded host; they do not reconstruct old hardware, old compilers, or every engine's past releases.

The backfill starts eight weeks before the UTC date anchor and uses the last reachable Wago commit before each weekly midnight. `WASMBENCH_HISTORY_ANCHOR=2026-10-01T00:00:00Z` reproduces the initial August 6 through September 24 selection. `WASMBENCH_HISTORY_WEEKS` accepts 1–52; the normal workflow uses eight. A fixed corpus source can be selected independently with `WASMBENCH_CORPUS_SOURCE`. Detached revision worktrees and isolated adapter copies preserve existing changes. The legacy adapter maps the old `PreparedFunction`/imports/host callback API without changing engine source. Historical correctness failures remain visible rather than becoming historical speed claims.

## Reproducibility and references

The runner installer provisions wasm-tools 1.260.0 when needed. For a standalone host, use `cargo install wasm-tools --version 1.260.0 --locked --root ~/.local/share/wasm-fyi/toolchains/wasm-tools-1.260.0`. `WASMBENCH_WASM_TOOLS` can select another path to that exact version.

`build.json` records the compiler version, source/artifact digests and exact compilation stages. `just features-build` verifies the Wasmtime 46.0.1 command adapter SHA before component adaptation. `just features-test` also checks that default admission still rejects proposal continuations, explicit `all` admission accepts them, and malformed input stays invalid. Adapter corrections are recorded in `patches/harness-capabilities.patch`; they apply to isolated copies and fail if the configured harness no longer matches. The legacy embedding mapping is separately recorded in `patches/legacy-wago-api.patch`.

Primary references: [WebAssembly specification tests](https://github.com/WebAssembly/spec/tree/main/test/core), [stack switching proposal](https://github.com/WebAssembly/stack-switching/blob/main/proposals/stack-switching/Explainer.md), [JS string builtins proposal](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md), [wasm-tools](https://github.com/bytecodealliance/wasm-tools), [WASI testsuite](https://github.com/WebAssembly/wasi-testsuite), and [Wasmtime 46.0.1](https://github.com/bytecodealliance/wasmtime/releases/tag/v46.0.1).

Daily evidence installation also refreshes the fixed current comparison baseline against the exact historical application artifacts, including the native Wasmer configurations. It preserves every historical Wago report, target week and collection date. `just history-baseline` updates only this baseline from already verified application reports; `just build` then stages it for publication. Comparison lines repeat one current measurement and do not describe past engine releases.

## Stable and development compatibility

The Features Compatibility matrix shows one latest **measured released** identity per engine. Development identities are hidden; older data is not renamed to the current upstream release. Hover for a backend breakdown and click for individual contracts, evidence and diagnostics. Missing released measurements remain “not collected”. Experimental flags are marked on released engines.

`data/feature-releases.json` records release provenance for exact runtime identities, including executable/dependency hashes and the complete adapter description. Register a new stable identity only after verifying its pinned release origin; a semver string alone is insufficient. Source builds with `engine_source_revision` or a main/development channel remain development builds regardless of their reported version. Unknown identities are labeled unverified.

The public `wasmbench/feature-support.json` retains `versions` alongside the latest `configurations` for each host. Each version has independent contract outcomes and evidence references. The browser projection uses only artifacts matching the current corpus and only the contract’s required scenario (compile, instantiate, or steady execution). Older versions and different compiler modes cannot fill a missing result in another build.

`just wago-plugin-tests` runs the released Wago WASI Preview 1/2 plugin tests and Component Model conformance fixtures on the Mac and `hub@hub` concurrently. Hub additionally runs the official Preview 1 WASI testsuite using the plugin's Linux-only runner. Both the engine and Component Model dependency are pinned to published releases in external modfiles. These commands collect correctness outcomes, not performance timings, so they do not acquire the performance measurement lock. Reports preserve failures and skips, and identify plugin tests separately from upstream suite cases. The command publishes sealed evidence; `just build` and the Pages deployment publish the website.
