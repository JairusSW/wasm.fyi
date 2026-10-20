# Proposal corpora and retained correctness evidence

The [complete census](../corpora/features/proposal-coverage.json) accounts for
all 51 entries on [webassembly.org/features](https://webassembly.org/features/),
including inactive proposals. The live identities fetched on October 20, 2026
matched the existing proposal snapshot. Support claims from that website are
not imported as correctness results.

This expansion adds **97 original source kernels / 291 size contracts** across
17 previously missing families, plus 26 separate native embedding programs.
The portable feature inventory now contains 248 artifacts and 725 contracts.
Compatibility inventory has no quota or cap. Input sizes, repetitions,
assertions, upstream files and distinct programs are separate counts.

## What is verified

- All 97 new artifacts reproduce byte-for-byte from their source recipes.
- 87 original kernels pass; ten remain unavailable: five shared-global probes
  and five `memory.discard` probes. No original oracle mismatch remains.
- Checks use 18 input sizes including zero, two fresh instances and three calls
  per input on each reused instance. Numeric WAT checks also compare every data
  byte. BigInt arguments/results remain exact 64-bit values throughout.
- The long execution inventory has 60 contracts: 55 pass their independent
  oracles and five `memory.discard` contracts remain unavailable. There are also
  37 separate compile/instantiate probes; those never enter steady execution.
- Fifteen native embedding performance recipes pass at 4,096 iterations:
  five ESM, five native type-reflection and five portable C API workloads.
  The C results additionally match independent JavaScript checksums.
- V8's **unmodified upstream runner passes all 538 enabled Wasm tests** for the
  exact native build, with its genuine build configuration, default variants
  and upstream status filters. This is the full enabled `mjsunit/wasm/*` suite
  for that build. It does not claim the other V8 test suites or other builds.
- All 12 C examples shipped with the pinned Wasmtime release compile and run.

The retained [reports](../corpora/features/reports/) contain source/artifact
hashes, executable/dependency hashes, flags, expected vectors, outcomes and
upstream source identities. No new performance scores were collected or
published. Existing proposal families are inventoried, not requalified by this
change.

## Added source families

| Family | Programs | Verification / performance scope |
| --- | ---: | --- |
| Typed function references | 5 | Direct, selected, composed, table and nullable-reference calls |
| Branch hinting | 5 | Actual section bytes and branch offsets; mixed branch distributions |
| Custom page sizes | 5 | Byte-addressed pages, boundary accesses, page counts and zero growth |
| Legacy exceptions | 5 | Payload, selective throw, rethrow, tag dispatch and catch-all |
| Shared-everything threads | 10 | Five shared-struct atomic kernels pass; five shared-global probes unavailable |
| Stack switching | 8 | Five execution kernels, including bound arguments, nested stacks and suspend/resume; three argument-form controls |
| Memory control | 5 | `memory.discard` source-valid, execution unavailable locally |
| Custom text annotations | 5 | Unknown, nested, Unicode, empty and multiple annotations |
| Extended name section | 8 | Actual names in type/table/memory/global/element/data/field/tag maps |
| Compilation hints | 5 | Compilation-priority payloads and semantic preservation |
| Numeric values in WAT | 6 | i8/i16/i32/i64/f32/f64 data, exact byte order and signed zero |
| JS BigInt integration | 5 | Exact high-bit, wrapping, signed division, multiplication and complement crossings |
| Instrument/tracing | 5 | Actual trace metadata and instruction offsets; ARM64 semantic controls |
| Half precision | 5 | Actual FP16 vector add/subtract/multiply/min/max on exact finite inputs |
| Stringref | 5 | Data-dependent Unicode lengths, concatenation, equality and code-unit access |
| Acquire-release atomics | 5 | Old and new RMW values checked; versioned wire format below |
| Custom descriptors | 5 | Payload, descriptor, identity, mutation and default construction |

The descriptor kernels retain every object from the last inner invocation in
an exported GC root array. Verification checks root counts, stored values,
distinct identities and fresh objects across calls. Their measurements would
include allocation, descriptor operations and root maintenance, rather than
claiming allocation-only instruction latency.

Long core execution kernels repeat 64 times inside Wasm. BigInt host-entry
contracts retain one crossing per invocation; repeating inside Wasm would
amortize away the operation those contracts exercise. The existing collector's
batch-duration rules still apply before publishing any timing result.

Text-only annotations and numeric data syntax are checked by the text assembler.
Binary compile/instantiate contracts are semantic controls. Timing syntax
throughput requires the pinned text assembler and must not be attributed to
core runtime execution. Advisory metadata passing execution does not prove
that a compiler used the hint; the full native upstream suite is separate
evidence for the implementation's hint behavior.

## Native embedding coverage

`corpora/features/host-proposals/manifest.json` uses paths relative to the
repository root. Its successful recipes are checked separately by
`scripts/feature-host-performance-check.mjs`; they are not portable Wasm
steady-loop contracts.

| Proposal | Programs | Result |
| --- | ---: | --- |
| ESM integration | 5 | Native loader: named function, unwrapped global, memory segment, host import and source-phase import |
| Type reflection | 5 | Native function/global/memory/table reflection and typed host-function construction; no polyfill |
| C/C++ API | 6 | Five pass; table-reference conversion unavailable in this Wasmtime C library |
| Memory control mapping API | 5 | Native API exists but cannot create a descriptor on this host |
| Web CSP | 5 | Ten allow/deny browser cases staged; Chrome aborts before navigation |

## Full upstream inventories

The [full source index](../corpora/features/upstream/full-suite-index.json)
pins complete file inventories and archive hashes. The unfiltered runner
attempted all **1,223 files**, retaining every outcome:

| Inventory | Passed / attempted | Remaining outcomes |
| --- | ---: | --- |
| Wasmtime misc WAST | 311 / 312 | Stack switching plus GC unsupported by this compiler configuration |
| Wasmtime's spec submodule | 267 / 288 | 14 custom-descriptor files, four legacy text-grammar files, three unsupported custom assertion directives |
| Wasmtime's component submodule | 72 / 74 | One trap-message mismatch and one unavailable `cm64` feature |
| V8 Wasm JS/MJS files, unfiltered | 537 / 549 | Missing mapping helper, ten build-disabled flags, one interpreter-only timeout |

These are whole-file outcomes, including helper files, not assertion counts.
The unfiltered V8 lane intentionally does not apply upstream status skips.
The separate **538/538 official-runner result** applies those rules, excluding
platform/build-disabled and interpreter-only tests as upstream specifies.
Skips are not counted as passes. The native WAST lane covers all source files,
not Wasmtime's Rust backend/allocator/collector matrix.

Suite-source pins: Wasmtime `823d1b8f251494a06288194d0df746191f535ff7` (46.0.1), its
testsuite submodule `0dc0343c9876267d99a7577ed4fc2289406a7869`, its component
submodule `694d789e46eaa8c52bfbc93871e2190a9f8afc60`, and V8
`34f4bf16f621ceba505ef2b7b818d48d09a5d3d3` (15.2.20). The V8 shell is separately
identified by a checksum-pinned public canary archive and executable hashes;
its build configuration is retained.
Licenses stay with the upstream archives. The unmodified vendored encoder has
its own source pin and BSD license under `corpora/features/third-party/v8/`.

## Explicit gaps and partial coverage

Ten proposals have no qualified executable corpus here: Flexible Vectors,
Frozen Values, JIT Interface, JS Primitive Builtins, More Array Constructors,
Multibyte Array Access, Profiles, Relaxed Dead Code Validation, Rounding
Variants and Type Imports. The census records a reason for each. In particular,
assembler support for rounding opcodes does not establish an execution engine,
and ordinary Wasm acceptance does not establish a specific profile.

Six additional rows are partial:

- Acquire-release uses V8 15.2.20's ordering encoding (memarg bit 5). The current
  proposal Overview uses bit 4. The newer wire format is not qualified here.
  Single-agent RMW checks do not establish inter-thread ordering.
- Shared-struct atomics pass, while shared globals are rejected by this V8.
  Concurrent correctness coverage remains in the upstream suite.
- Memory discard and mapping remain unavailable on this host.
- Trace metadata and results pass; V8's native trace-marker emission is x64-only
  and is unverified on this ARM64 host.
- `wasm_func_as_ref` is reported as unimplemented by the C library; the portable
  table case remains unavailable.
- Chrome 155 exits with SIGABRT before loading a page, including an independent
  `about:blank` preflight. CSP cases remain unverified, not passing.

## Reproduce

Prerequisites are Node 26.4.0, wasm-tools 1.260.0, Wasmtime 46.0.1, Python,
tar and unzip. The C lane also requires Clang and the Wasmtime 46.0.1 C library
(`WASMBENCH_WASMTIME_C_PREFIX`). The browser lane accepts `WASMBENCH_CHROME`.
`scripts/proposal-toolchain.mjs` installs the checksum-pinned V8 shell on
Linux x64 or macOS ARM64. Other hosts require an explicitly qualified shell.

`just features-proposals-source-check` builds into a newly created, empty
directory under `.wasmbench/proposal-source-builds/`. It regenerates the 97
correctness kernels, builds 60 performance kernels using only those fresh
outputs, compiles five ESM modules, builds the native C API runner and compiles
every C example in the pinned Wasmtime source archive. All **162 Wasm outputs**
must match the recorded hashes. JavaScript hosts run from source; their fresh
copies receive syntax checks. The build does not depend on browser availability
or count unsupported execution as successful correctness evidence.

The retained [clean build report](../corpora/features/reports/proposal-source-build.json)
records each source hash, output hash, compiler command and dependency identity.
Compilers and runtime libraries are build prerequisites; the command does not
rebuild those tools. To build the pinned Wasmtime C library from its source
archive, run its upstream CMake install recipe from that archive's root:

```sh
wasmtime_c_prefix="$HOME/.local/share/wasm-fyi/toolchains/wasmtime-c-api-46.0.1"
cmake -S crates/c-api -B target/c-api -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DWASMTIME_USER_CARGO_BUILD_OPTIONS=--locked --install-prefix "$wasmtime_c_prefix"
cmake --build target/c-api
cmake --install target/c-api
export WASMBENCH_WASMTIME_C_PREFIX="$wasmtime_c_prefix"
```

This installs the library and matching headers outside the refreshed source
cache, including generated
`wasmtime/conf.h`. Use that prefix when running the source check from wasm.fyi.

`node scripts/corpus-build-all.mjs` includes the portable source check
(`--wasm-only`), including the ESM modules and JavaScript sources. The separate
command below additionally requires Clang and the Wasmtime C library and builds
all native workloads. The upstream WAST/JS suites are pinned source inputs,
compiled by the runtimes when their suite checks run.

On the shared Apple host, run builds and checks through its reservation:

```sh
python3 ~/benchmark-lock.py --owner wasmfyi-proposals --wait -- just features-proposals-build
python3 ~/benchmark-lock.py --owner wasmfyi-proposals --wait -- just features-proposals-source-check
python3 ~/benchmark-lock.py --owner wasmfyi-proposals --wait -- just features-proposals-check
python3 ~/benchmark-lock.py --owner wasmfyi-proposals --wait -- just features-v8-official-check
python3 ~/benchmark-lock.py --owner wasmfyi-proposals --wait -- just features-host-proposals-check
python3 ~/benchmark-lock.py --owner wasmfyi-proposals --wait -- node scripts/feature-host-performance-check.mjs
```

`node scripts/proposal-upstream.mjs prepare` retrieves complete pinned sources;
`check` runs the unfiltered inventories and returns nonzero for any failure,
crash or runner error. The kernel checker preserves unavailable outcomes;
`--require-all` additionally returns nonzero for those. The host checker returns
nonzero for the retained browser crashes. Its report is still written.

CI now installs the pinned encoder validator, runs the new negative-oracle
guards, builds/verifies proposal contracts and runs the official V8 Wasm suite.
Those workflow changes have not been run on GitHub in this work.

The source-build follow-up passes **46 focused tests**, with one existing GC
performance fixture check skipped. All eight curation checks pass in the current
tree. Earlier baseline failure logs remain retained for history. This is not a
claim that the whole repository test suite passes.
