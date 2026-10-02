# Compile latency audit

The uncached compile boundary is the engine compile API over resident, checksum-verified Wasm bytes. Runtime construction, file I/O, instance creation, output verification and resource release occur outside that timer. Instantiation and first-call timing retain their own boundaries. Failed or unsupported trials never supply headline timings.

## Findings on October 2, 2026

The scalar wazero adapter called setup before its compile loop. Setup retained the same compiled module in the same runtime, allowing subsequent `CompileModule` calls to reuse compiled code. Three independent scratch fixtures measured fresh compilation 13–23 times slower than the affected wasm-bench timings. The fix prepares an empty runtime, verifies each newly compiled module after timing, then closes the instance and compiled module. A regression test also seeds an earlier execution before the compile request, catching retained state across scenarios.

V8 enables its native-module cache by default. With the existing eager optimizing tier, repeated `WebAssembly.Module` calls measured approximately 1.3 microseconds on two fixtures. Disabling the cache measured approximately 297 and 598 microseconds. Controlled V8 configurations now require `--no-wasm-native-module-cache` alongside their eager tier locks.

Wago's compile API matched the independent scratch measurements on the initial three fixtures; no Wago timer correction was needed. These checks establish the tested API boundary, not accuracy for every workload or future adapter revision.

The measured-data boundary withholds older wazero and V8 compile cells without the new uncached policy. Their sealed raw evidence is retained, and execution metrics remain independently usable. Current collection must pass the strict policy; explicitly permitted legacy descriptions apply only to previously collected evidence.

## Reproduction

After building the selected released adapters in an isolated harness snapshot:

```sh
WASMBENCH_ROOT=/path/to/isolated/harness node scripts/compile-latency-audit.mjs /path/to/unique/audit-directory
```

The audit independently compiles three application fixtures using Go APIs and standalone V8 processes, then runs those same bytes through wasm-bench for Wago, wazero, V8 optimizing and V8 Liftoff. It retains scratch samples, exact artifacts, compiler/source identities, sealed harness trials and a comparison report. Three independent harness launches with five verified samples each must have medians within a factor of four of the scratch medians. This is a broad discrepancy gate; it does not claim nanosecond agreement between process layouts.

## Complete collection and history

`WASMBENCH_SUITE=all` combines all 166 curated application contracts and 223 feature contracts. `scripts/full-run.mjs` builds every configured platform adapter, runs the scratch audit, then collects timing, memory and native-code evidence. Steps run sequentially on each host; Mac ARM64 and Hub AMD64 can run concurrently. Detached supervisors retain per-step logs, child PIDs and atomic `status.json` files. Hub uses a persistent SSH master and its measurement lock.

The queue requests 53 Wednesday targets, covering 52 weekly intervals from October 1, 2025 through September 30, 2026. Releases are selected as of each Wednesday, and collection timestamps remain retrospective. The existing official-conformance history runner follows current collection. It does not reconstruct performance history; that remains a separate required part of the full-year work. Missing qualified runners and unpublished releases are explicit gaps, not passing results. WAVM's upstream release inventory currently contains only nightly builds, excluded by the release-only policy.

`just history-performance-plan` prepares a separate performance queue containing every engine/Wednesday pair and the complete application and feature corpus. To reuse an already prepared full corpus without invoking its importer, set `WASMBENCH_HISTORY_SUITE` to its manifest. The planner verifies the complete ID set and every artifact digest. Release jobs share work only when release identity, host, corpus contracts (including oracles), adapter/recipe source, toolchain pins, options and configurations match. Jobs remain pending until a release-specific collector produces verified evidence; planning does not create historical measurements. The current full-year inventory resolves to 182 distinct release jobs per host and 156 unavailable engine/Wednesday points.

`just history-performance-collect` executes that queue using disposable harness copies. Release bindings currently cover Wago, wazero, Wasmtime and Wasmi; the other engines remain pending binding implementation. The collector checks runtime descriptions before measuring, verifies each timing/memory/code bundle and its complete corpus cohort, and verifies the final report before caching it. Each historical Wago/wazero release must also pass its own independent scratch audit, using the same release rather than the current engine. Cargo intermediate directories are removed only from the owned attempt after evidence is sealed; archived tools, source, raw trials and logs remain available.

The Linux collector acquires the same measurement lock as the Hub full-run supervisor. The Mac collector rejects a still-live full-run owner. `scripts/history-after-full-run.mjs <full-run-status.json> <follow-up-directory>` provides a durable handoff: it polls the actual owner process and starts historical collection only after that owner exits. Observation errors are retried. The full objective remains incomplete until every available released-engine job has a qualified binding, verified evidence and published history.
