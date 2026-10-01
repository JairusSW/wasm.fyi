# Measured data integration audit

The published measurement endpoints are verified, but the existing views still consume synthetic preview data. Deployment success proves data publication, not completed view integration. Reproduce the identity audit with `just integration-audit`.

## Current configuration mapping

| Existing slot | Existing label | Published configuration | Required treatment |
| --- | --- | --- | --- |
| A | Wasmtime Cranelift 37.0.1 | Wasmtime Cranelift 46.0.1 | Use measured version and per-host input identity |
| B | Wasmtime Winch 37.0.1 | Wasmtime Winch 46.0.1 | Use measured version and per-host input identity |
| C | Wasmer LLVM | No measured configuration | Collect this backend or explicitly show not measured |
| D | Wasmer singlepass | No measured configuration | Collect this backend or explicitly show not measured |
| E | wazero interpreter | wazero compiler 1.12.0 | Do not put compiler measurements under an interpreter label |
| F | V8 tiered | Default production tiering, different versions per host | Use each host's recorded engine version |
| G | Wago interpreter | Wago Railshot | Do not put JIT measurements under an interpreter label |

The 21 named preview workloads have no exact identifier match in the measured contract inventory. Wago application contracts and the original feature suite provide real alternatives, but their names, inputs and oracles must be presented accurately. The preview's group totals and 1,284-workload claims are not measured counts.

## Wiring requirements

1. Replace `src/lib/model.ts` synthetic noise, machine multipliers and fabricated history with case lookups by host, pinned configuration, artifact digest and scenario. Preserve missing, unsupported, failed and compile-only states. Do not interpolate missing history.
2. Generate the workload catalogue from measured contracts and independently check per-view coverage. Aggregate only the actual shared successful cohort; expose its count. Derive uncertainty from recorded launches rather than assigning synthetic confidence intervals.
3. Replace data and factual labels in the existing components without changing their layout or controls. Update sample counts, units, runtime backends, machine labels and measurement scope together with values. Timing nanoseconds convert to milliseconds; throughput also needs guest units per invocation.
4. Replace feature and compatibility summaries with the representative corpus outcomes. These are not full specification-conformance results or evidence of browser release support. Optional configurations remain separately identified.
5. Connect proposal views only to matching contracts. Worker results cover Node's embedding and 1/2/4/8 workers, not every runtime or the preview's 16-worker endpoint. Memory-per-worker and false-sharing claims need matching measurements; absent fields stay not measured.
6. Connect eight retrospective weekly Wago points per host and their pinned fixed-engine baseline. Other engines have a fixed comparison baseline, not eight historically released binaries. Preserve actual collection dates and historical correctness failures.
7. Replace fabricated drill-down samples, memory traces, run facts and issue links with recorded evidence, or show explicit absence. Reuse-model predictions must distinguish modeled behavior from directly measured lifecycles.
8. Check every existing route and control on both host selections, then verify deployed values against their raw evidence hashes. A green static-page build alone does not prove these behaviors.

The layout and controls have not been changed. The scope decision about replacing their displayed preview values is pending.

## Adapter available for wiring

`src/lib/measured.ts` loads compact projections through the supplied hosted base path and checks their SHA-256 and index metadata. Callers select a real runtime ID, exact workload ID, artifact digest and scenario. Timing, exact memory observers and extracted code-image bytes have separate accessors. Failed launches withhold values; incomplete memory coverage and unavailable images remain explicit missing states. Image bytes do not imply active function-code bytes.

The history accessor checks host identity and weekly manifest provenance, retains gaps, and labels current comparison engines as a fixed baseline. It does not manufacture historical engine releases. The adapter's tests exercise the checked-in datasets for both hosts and deliberately corrupt projection bytes and metadata. This boundary is ready for view integration; the existing views do not call it yet.

## Wasmer native SDK preflight

`just wasmer-preflight` and `just wasmer-preflight-hub` compile a small native C API probe against the host's installed SDK. Hub uses a persistent SSH control socket, an isolated directory and the shared measurement lock. The probe compiles the original integer arithmetic artifact, instantiates it, calls its export with input `1`, and verifies exact result `3`. The report pins the artifact, probe source and executable, SDK library, header inputs and compiler invocation. These are correctness diagnostics, not benchmark timings or general feature-support results. Published reports live under `wasmbench/preflight/wasmer/`.

On the Mac's installed 7.3.0 SDK, Singlepass passes this native preflight. The SDK reports LLVM is not compiled in, even though the installed CLI can compile the same module with LLVM. Therefore an LLVM native adapter needs an SDK build that enables LLVM; CLI flag presence cannot substitute for a working embedded backend. The LLVM compiler crate for this version selects LLVM 22; the Mac has LLVM 22.1.8, while Hub currently has LLVM 18. Host SDK versions also differ. These facts must be resolved or recorded before collecting comparable configurations.

`just wasmer-sdk-build` builds an isolated SDK from release commit `35c10644f7b0aad6fd9458624ceb8429fe7413c4`, with LLVM, Singlepass, Cranelift and WASI enabled. Cranelift is required by the upstream default C API configuration constructor before another compiler can be selected. The build checks the LLVM 22.1 prefix, initializes the pinned NAPI submodule, uses the release's locked dependencies, packages generated headers and records source, compiler and library digests. Set `WASMBENCH_LLVM_PREFIX` on hosts whose LLVM 22.1 installation is elsewhere.

The managed Mac SDK passes the native call probe with **both LLVM and Singlepass**. `just wasmer-preflight` prefers this SDK once built; `WASMBENCH_WASMER_SDK` can explicitly select another prefix. Existing installed SDKs are preserved. This resolves the Mac backend prerequisite; protocol adapters and full benchmark collection for these configurations are still outstanding.

Hub's installed 7.1.0 SDK also passes Singlepass and reports LLVM unavailable. Its probe was collected under the shared measurement lock. Hub needs an LLVM 22.1 toolchain and the managed SDK build before collecting the same LLVM configuration as the Mac; this remains outstanding.

Primary API references: [Wasmer Rust API](https://wasmerio.github.io/wasmer/crates/doc/wasmer/) and [Wasmer LLVM 7.3.0 source](https://docs.rs/crate/wasmer-compiler-llvm/7.3.0/source/Cargo.toml).
