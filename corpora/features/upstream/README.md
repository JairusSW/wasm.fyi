# Curated upstream positive semantic corpus

This is a source-pinned correctness supplement, not a replacement for complete
official conformance suites and not a performance benchmark suite.

## Inventory

- Nine WebAssembly/spec WAST selections: 123 positive result assertions.
- V8 JS-string builtins: 44 portable positive semantic vectors.
- Wasmtime component strings: nine valid string fixtures across nine encoding
  pairs, 81 vectors. Encoding pairs are test dimensions, not 81 algorithms.

Every entry in index.json records repository, exact commit, upstream file,
upstream SHA-256, transformed-file SHA-256, license, and execution status.
Full upstream source files were read at those revisions; only allowlisted
positive selections or portable vector adaptations are retained here.

## Running and integration

The spec/*.positive.wast files retain WAST syntax and upstream assertions.
Run `node scripts/feature-upstream-spec.mjs --wasm-tools=/path/to/wasm-tools
--require-all --out=/path/to/report.json` with wasm-tools 1.260.0. The runner
uses json-from-wast, validates modules, verifies source pins/local hashes,
and executes each script in a fresh Node process with a 30-second deadline.
The ordinary spectest.print_i32_f32 import and stable externref identities are
provided. Integer and floating-point assertions use exact scalar oracles.
V128 and i31 assertions use small Wasm-side wrappers which import the original
export directly, leaving the upstream module unchanged. Vector checks compare
all 128 bits and retain all upstream permitted either-result alternatives.
Wrapper source and binary hashes are retained with the result.

The JSON vectors run through dedicated, untimed adapters:

- `node scripts/feature-upstream-v8.mjs --require-all`: all 44 selected cases
  execute native Wasm `wasm:js-string` imports with the builtins option. The
  runner rejects JavaScript polyfill substitution and verifies source/artifact
  hashes. `--build` regenerates its adapter using pinned wasm-tools.
- `node scripts/feature-upstream-components.mjs --require-all`: all 81 encoding
  pairs/string fixtures execute actual canonical lifting/lowering between
  separate provider/consumer component memories with Wasmtime 46.0.1. It does
  not rely on the scalar-only performance adapter.

These two runners passed all selected vectors locally and write evidence under
`.wasmbench/feature-upstream-{v8,components}.json`. Vector expectations remain
pinned upstream data; results are never used to generate expectations.

The retained reports/node-v24.19.0.json records 123/123 positive WAST assertions
and six setup calls passing on Linux x64, Node 24.19.0/V8 13.6.233.17-node.51.
It records actual collection time, executable hashes, module hashes and flags.
The index status fields reflect initial curation admission; execution evidence
lives in reports, separately from the source inventory. Engine-vector execution
is separate from this spec runner. Unsupported engine features remain explicit;
oracle mismatches fail. --require-all also fails for skipped/unsupported cases.
No correctness result is performance evidence.

`node corpora/features/upstream/runner-regression.mjs /path/to/wasm-tools`
checks digest rejection and deliberately wrong scalar/vector oracles in
disposable copies; retained upstream fixtures are never changed.

## Selection and adaptation

Only first ordinary modules and bounded positive assertions are selected.
The factorial exhaustion assertion is omitted. Direct tail calls omit
million-step assertions. Indirect tail calls stop before negative assertions.
Table and i31 selections stop before negative assertions. GC array-copy keeps
positive assertions in original order and omits negative assertions; ordinary
copies, overlap behavior and zero-length successes remain. Multi-memory
retains positive setup invocations. The selected files may still define unused
ordinary semantic helper functions whose negative assertions were omitted.

V8 vectors adapt positive operations and ordinary Unicode fixtures, omitting
native string-representation constructors and negative paths. Wasmtime vectors
preserve its STRINGS values and materialize the ENCODINGS pair iteration.
Expected values are semantic literals, never inferred from candidate Wasm.
Do not count size variants, encoding pairs, or assertions as distinct programs.

## Attribution

WebAssembly/spec test sources: Apache-2.0, retained in
licenses/spec-test-LICENSE. This is the test-directory license; the proposal
documents' CC0 designation does not apply to these tests.

V8 sources: Copyright 2023 the V8 project authors. All rights reserved.
BSD-3-Clause terms and notices are retained in licenses/v8-LICENSE.

Wasmtime sources: Apache-2.0 WITH LLVM-exception, full terms including the
exception retained in licenses/wasmtime-LICENSE.

Modifications consist of explicit positive-case selection, explanatory headers,
and the portable JSON vector adaptations described above. Upstream authors do
not endorse this corpus. Review per-file/subdirectory licenses again when
adding a new upstream source. Preserve upstream notices and label modifications.
