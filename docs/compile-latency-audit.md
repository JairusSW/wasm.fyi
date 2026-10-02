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

`WASMBENCH_SUITE=all` combines all 166 curated application contracts and 232 feature contracts. `scripts/full-run.mjs` builds every configured platform adapter, runs the scratch audit, then collects timing, memory and native-code evidence. Steps run sequentially on each host; Mac ARM64 and Hub AMD64 can run concurrently. Detached supervisors retain per-step logs, child PIDs and atomic `status.json` files. Hub uses a persistent SSH master and its measurement lock.

The queue requests 53 Wednesday targets, covering 52 weekly intervals from October 1, 2025 through September 30, 2026. Releases are selected as of each Wednesday, and collection timestamps remain retrospective. The existing official-conformance history runner follows current collection. It does not reconstruct performance history; that remains a separate required part of the full-year work. Missing qualified runners and unpublished releases are explicit gaps, not passing results. WAVM's upstream release inventory currently contains only nightly builds, excluded by the release-only policy.
