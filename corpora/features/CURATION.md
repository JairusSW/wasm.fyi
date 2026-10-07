# Feature curation: execution workloads and upstream semantic checks

This change adds **49 execution contracts in 16 shared multi-export modules**,
including one explicitly labelled GC loop-copy baseline. The complete feature
inventory has **290 contracts, 168 workload recipes and 135 unique artifacts**.
All **21 execution-capable families** have at least five distinct operation
families. Input-size variants and baselines do not count toward that minimum.

The corpus and its source generator live in **wasm.fyi**. The separate
[wasm-bench](https://github.com/JairusSW/wasm-bench) repository supplies measurement
adapters and report collection. No wasm-bench source change is required.

## What was added

| Feature | Additional operations |
| --- | --- |
| core control | branch-table state machine, nested divisor counting, early-return search |
| core table | indirect composition, comparator-driven sorting, token dispatch, tree traversal |
| multi-value | Euclid state, Fibonacci state, ordered pair, integer square root state |
| tail calls | mutual parity, Euclid, binary search, digit sum |
| core memory | strided gather, packed record fields, prefix scan |
| reference types | cross-table dispatch, sparse reference compaction |
| bulk memory | record packing, sliding-window compaction, pattern expansion |
| memory64 | strided gather, prefix scan, unaligned record transform |
| multi-memory | sorted merge, stencil, ping-pong diffusion |
| exceptions | multi-value payload catch, nested tag dispatch |
| relaxed SIMD | finite truncation/zero lanes, bounded rounded Q15 multiplication |
| JS strings | UTF-16 character roundtrip, supplementary codepoint roundtrip |
| GC | array.copy with full checksum; element-loop comparator baseline |
| components | sibling pipeline, fanout reduction, conditional service, bounded feedback |
| canonical ABI | record, mixed-width tuple, option presence, flags |
| resources | representation checksum, paired live handles, reverse release, two resource types |

These are original bounded implementations with independent JS/value-semantic
oracles. The GC bulk/loop comparison records a pinned V8 design reference in
its manifest provenance; it is not presented as copied V8 test code. Existing
core numeric, SIMD, threads and WASI families already meet the diversity floor.

`core-val`, `extended-const`, and `cm-async` intentionally remain structural
compile/instantiate workloads. There is no meaningful execution algorithm for
an otherwise-unused type declaration; they are excluded from execution timing.

One artifact can own several named exports. Selecting one export for rebuild
refreshes every contract sharing its module, preventing stale sibling hashes.
Generated WAT, Wasm, build recipes and manifest checksums are checked in.

## Timing contract

Use the existing harness's **steady / timing** scenario, not process elapsed
time, compiler duration, or a conformance runner. For example, with the normal
wasm-bench runtime configuration and adapters already built:

```sh
just features-curation-check
just features-execution-suite
# From the configured wasm-bench checkout, substitute the absolute site path:
go run ./cmd/wasmbench run \
  --suite /absolute/path/to/wasm.fyi/.wasmbench/feature-execution.json \
  --runtimes v8 --validation-profile all \
  --scenarios steady --profile timing \
  --launches 3 --samples 10 --operations 100 --warmup 3 \
  --out /absolute/path/to/results
```

The execution suite contains 281 contracts and excludes all nine structural
contracts. It never contains upstream WAST or JSON semantic assertions.
Runtime capability admission still applies; unsupported proposals remain
unsupported, not zero-duration measurements or correctness passes.

In the existing V8 adapter, module compilation, instantiation, initializer
exports, argument preparation and result checks occur outside steady timing.
The timed region contains exported calls (including unavoidable embedding call
and result-storage overhead). Immutable data segments initialize at
instantiation. Algorithm-intrinsic scratch restoration, GC allocation, resource
creation/release, and host calls remain part of their workload and are not
misrepresented as setup-free arithmetic. Fresh-instance reset contracts use
fresh instances outside the timed invocation. Other engine adapters retain
separate capability and timing policies; no universal support claim is made.

No new performance scores or historical measurements are published by this
change. Collect fresh reports for the new artifact digests.

## Actual upstream semantic cases, separately executed

The positive correctness supplement contains **123 WebAssembly/spec assertions,
44 V8 JS-string vectors, and 81 Wasmtime component string vectors**. The 81
encoding/string combinations are test cases, not 81 distinct algorithms.

- `upstream/index.json`: exact source commits, paths, original-source SHA-256,
  transformed-file SHA-256, licenses, selection rules and harness requirements
- `upstream/spec/`: actual selected positive WAST modules/assertions
- `upstream/vectors/`: explicitly adapted upstream positive test data
- `upstream/licenses/`: preserved upstream license text and notices
- `upstream-adapters/`: small, original portable adapters

```sh
node scripts/feature-upstream-spec.mjs --require-all
node scripts/feature-upstream-v8.mjs --require-all
node scripts/feature-upstream-components.mjs --require-all
```

The spec runner converts selected WAST with pinned wasm-tools and executes
assertions in isolated Node processes. Wasm-side wrappers test v128 and i31
results without routing those values through unsupported JS signatures.
The V8 runner executes actual `wasm:js-string` imports, never a JS polyfill.
The Wasmtime runner constructs distinct provider/consumer components and
memories, exercising actual canonical string transcoding across UTF-8,
UTF-16 and compact Latin1/UTF-16 encodings.

These runners are untimed and have independent reports in `.wasmbench/`.
Failures, missing adapters and unsupported capabilities remain distinct;
`--require-all` rejects incomplete verification. Selection is explicitly
positive-only, excluding malformed/invalid inputs, exhaustion and engine
security regressions. This is a curated supplement, not full official-suite
conformance or evidence that every engine implements a proposal correctly.

## Verification

Pinned compiler: wasm-tools 1.260.0. Pinned component runner: Wasmtime 46.0.1.
The local run used Node 24.19.0; CI retains the repository's Node 26.4.0 pin.
The dedicated checks cover four input sizes and repeated calls per new kernel,
shared-module/source integrity, independent arithmetic oracles, operation
counts, attribution, and deliberate wrong-oracle rejection. Local focused
checks passed: 196 kernel/input combinations; all 248 upstream assertions or
vectors; 15 curation/adapter unit tests; checked-in feature manifest integrity.

The entire application corpus and website build are separate checks; these
focused results are not a claim that all application toolchains or UI builds
were run. Existing historical-data tests require the large retained data tree.
