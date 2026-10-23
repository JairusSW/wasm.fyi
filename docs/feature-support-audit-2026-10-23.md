# Runtime feature-declaration audit — 2026-10-23

This audit compares wasm.fyi's current feature-enablement and unsupported-result
policies with upstream runtime documentation and the
[webassembly.org feature inventory](https://webassembly.org/features/). The
website inventory is useful for finding candidate features, but an entry there
is not treated as execution evidence. A wasm.fyi support result still requires
the source-pinned adapter to execute the applicable corpus oracle.

The review covers the runtime policies under `scripts/lib`, the feature adapters
under `adapters`, and the source-bound harness patches under `patches`. It does
not change policy or reinterpret existing measurements.

## Actionable mismatches

### 1. Wasmtime compact imports are disabled despite upstream support

**Confidence: high.**

`patches/harness-wasmtime-shipped-features.patch` explicitly sets
`WasmFeatures::COMPACT_IMPORTS` to `false` for both Cranelift and Winch. Current
Wasmtime documentation lists compact imports as implemented, tested, finished,
and exposed through both Rust and C APIs. It is disabled by default and must be
enabled through `Config::wasm_compact_imports`; this is precisely the kind of
opt-in proposal the feature adapter is intended to enable. See the official
[Wasmtime proposal matrix](https://docs.wasmtime.dev/stability-wasm-proposals.html#tier-3-webassembly-proposals)
and the versioned
[`Config` API](https://docs.rs/wasmtime/46.0.1/wasmtime/struct.Config.html#method.wasm_compact_imports).

Recommended change: enable `WasmFeatures::COMPACT_IMPORTS` for the latest
Wasmtime Cranelift configuration, then run the complete compact-import corpus.
Enable it for Winch only after checking the exact v46.0.1 backend source or an
execution probe, because Wasmtime's top-level matrix primarily guarantees the
Cranelift tier. Record the explicit config bit in `validator_features`.

This affects future latest-version captures. It does not justify rewriting old
unsupported or unmeasured cells.

### 2. Wizard opt-in flags are not backend-scoped

**Confidence: high for configuration accuracy; medium for observed-result
impact.**

`scripts/lib/wizard-sdk.mjs` and `adapters/qualification/wizard/adapter.py` pass
the same five proposal flags to V3, fast-int, and SPC. Wizard's official backend
matrix is narrower:

| Feature | V3 | fast-int | SPC |
| --- | --- | --- | --- |
| custom page sizes | full | absent | absent |
| stack switching | full | full | full |
| wide arithmetic | full | full | full |
| legacy EH | full | partial | partial |
| threads | partial | partial | absent |

Source: Wizard's official
[feature-support table](https://github.com/titzer/wizard-engine#feature-support).

Recommended change: derive flags by backend. V3 may request all five; fast-int
should omit custom page sizes and keep partial features explicitly labeled;
SPC should omit custom page sizes and threads and keep legacy EH explicitly
partial. Continue using exact execution probes as the final authority. A loader
accepting an enabled proposal does not establish that the selected executor can
run it.

### 3. Wasmtime's branch-hint declaration is revision evidence hidden in text

**Confidence: high for data-model fragility; no current support result is known
to be wrong.**

`scripts/lib/feature-support.mjs` recognizes Wasmtime branch hinting by matching
the phrase `explicitly enables branch hints` inside a free-form evidence string.
The same adapter already emits a structured `branch_hinting` boolean, and
Wasmtime documents the proposal as an off-by-default option exposed by
`Config::wasm_branch_hinting` in its
[proposal matrix](https://docs.wasmtime.dev/stability-wasm-proposals.html#tier-3-webassembly-proposals).

Recommended change: consume the structured, source-bound boolean and exact
configuration receipt. Retain the Cranelift-only restriction until Winch's use
of branch hints is demonstrated. This removes a declaration that can silently
break when explanatory prose changes.

## Policies that match upstream declarations

- **Wasmer:** wasm.fyi's backend split matches the official
  [Wasmer matrix](https://docs.wasmer.io/runtime/features/): SIMD and relaxed
  SIMD are absent in Singlepass; wide arithmetic is present in Cranelift and
  LLVM; tail calls are LLVM-only; threads are listed for every backend. The
  current policy correctly keeps Cranelift tail calls disabled and enables
  threads. The matrix says Cranelift and LLVM support exceptions, which matches
  the current adapter policy.
- **Wasmi:** the source-bound patch enables the two required crate features
  (`memory64`, `simd`) and then opts into custom page sizes and wide arithmetic,
  both disabled by default. This matches the official
  [`wasmi::Config` API](https://docs.rs/wasmi/latest/wasmi/struct.Config.html).
  Tail calls, extended const, multi-memory, SIMD, and relaxed SIMD are documented
  as on by default in the applicable build.
- **WasmEdge:** `scripts/lib/wasmedge-feature-policy.mjs` discovers the proposal
  enum from the exact SDK and enables each available proposal. That is safer
  than a version-only table and agrees with WasmEdge's official
  [proposal/API mapping](https://wasmedge.org/docs/start/wasmedge/extensions/proposals/).
  The interpreter-only annotation exception is source-bound rather than applied
  to all backends.
- **WAMR:** the policy's backend restrictions match the official
  [build-option documentation](https://github.com/bytecodealliance/wasm-micro-runtime/blob/main/doc/build_wamr.md):
  final exception handling is not implemented; legacy EH and multi-memory are
  classic-interpreter-only; Memory64 is classic-interpreter/AOT only; GC is not
  available in fast JIT or multi-tier JIT. Keeping these restrictions by exact
  build mode is required.
- **Wasm3:** the repository correctly distinguishes partial typed function
  references and atomics-only threads from full support. Upstream calls bulk
  memory, EH, multi-memory, Memory64/Table64, reference types, tail calls,
  custom page sizes, compact imports, stack switching, and wide arithmetic
  ready, while full threads, GC, and fixed-width SIMD are unavailable. See the
  official [Wasm3 feature table](https://github.com/wasm3/wasm3#features).
- **Wizard:** core Wasm 3.0 proposals are correctly treated as candidates. The
  only correction is backend scoping of opt-in flags described above.
- **GraalWasm:** descriptor discovery in `scripts/lib/graalwasm-sdk.mjs` is the
  right mechanism: only options exposed by the exact SDK are enabled. The
  requested option list covers the documented Memory64, wide arithmetic,
  exceptions, legacy exceptions, typed function references, GC, relaxed SIMD,
  and tail-call switches. Graal's official
  [Wasm changelog](https://github.com/oracle/graal/blob/master/wasm/CHANGELOG.md)
  documents those switches and also confirms that branch hints are consumed by
  optimized code generation.
- **Wazero and Wazy:** the policies use the exact source's public feature-bit
  definitions instead of inferring support from a moving version table. That is
  appropriate for source-pinned builds. Failed execution in a declared feature
  remains a failure rather than being converted to unsupported.
- **WAVM, Chicory, Chasm, zwasm, Endive, libwasm, w2c2, wasm2c, wasm2go:** the
  current rules bind unsupported classifications to exact decoder/compiler
  diagnostics and, where needed, exact revisions. No high-confidence missing
  opt-in switch was found in the reviewed official material. These engines
  should continue to require exact corpus execution before publishing support.
- **V8, SpiderMonkey, and JavaScriptCore:** workload-scoped flags and
  source/revision-bound metadata declarations are the correct shape. In
  particular, branch hints and compilation hints cannot be proven by merely
  accepting an ignorable custom section. The implementation-consumption checks
  already present for JavaScriptCore and GraalWasm should remain mandatory.

## Cross-reference rules for the next captures

1. Use [webassembly.org/features](https://webassembly.org/features/) and its
   [machine-readable source](https://github.com/WebAssembly/website/blob/main/features.json)
   to identify candidates and flag/version requirements, never as a substitute
   for a passing runtime observation.
2. Pin every claim to runtime revision, backend, architecture, adapter command,
   and flags. Backend matrices matter: parser/load support is not executor
   support.
3. Enable an upstream opt-in only where the exact pinned SDK exposes it. An
   absent option stays unavailable; do not borrow a switch from a newer release.
4. For metadata proposals such as branch hints, compilation hints, extended
   names, and tracing, require source or upstream-suite evidence that the engine
   consumes the metadata. A semantic control only proves that the custom section
   did not change program output.
5. Preserve declared-feature bugs as failures. Unsupported classification is
   reserved for a source-bound absence or documented backend limitation.

## Capture order implied by this audit

1. Repair and recapture Wasmtime compact imports on Cranelift, then qualify
   Winch separately.
2. Split Wizard feature flags by backend and recapture only the affected
   proposal rows.
3. Replace Wasmtime's prose match for branch hints with structured receipt data;
   this requires no benchmark rerun if the exact existing receipt already
   contains the boolean and all identity hashes remain equal.
4. Keep all other latest-version feature runs on their current policies, while
   treating observed oracle mismatches in declared features as runtime defects.
