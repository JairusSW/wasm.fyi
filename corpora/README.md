# Corpus sources and correctness

The default application inventory is 166 distinct algorithms in 27 categories,
with 6–9 algorithms per category. Of these, 102 are original import-free C
kernels. The remaining 64 are selected upstream workloads, including full WASI
applications. Feature probes are a separate inventory and never inflate
application averages. The six former Emscripten defaults are replaced by clearly
named DNA and text kernels; these do not claim to run seqtk, FastTree or GNU sed.

## Build and edit local fixtures

Use Node **26.4.0 / V8 14.6.202.34-node.21**, LLVM Clang **22.1.8**, and
`wasm-tools` **1.260.0**. Set `WASMBENCH_CLANG` and `WASMBENCH_WASM_TOOLS` if
those tools are outside their default locations.

```sh
just applications-build       # C -> 102 import-free MVP modules, then V8 checks
just features-build           # generated WAT -> core modules and components
just corpus-v8-local-check    # no Wago or wasm-bench checkout needed
node --test scripts/corpus-v8.test.mjs scripts/upstream-sources.test.mjs
```

Edit `applications/sources/kernels.c` together with the independent JavaScript
algorithm in `../scripts/lib/application-kernels.mjs`. Each algorithm's `KIND`,
representative size, work units and full-output checksum are recorded in
`applications/manifest.json`. Inputs and checksums are part of the measured call.

Edit `features/generator.mjs`, then regenerate the checked-in WAT, Wasm,
`manifest.json` and `build.json`. Preview 2 commands are Preview 1 core modules
wrapped by the SHA-256-pinned Wasmtime **46.0.1** adapter; the recipe records both
stages. The generator and expected values are checked independently of guest
output. Core fixtures avoid host imports unless the feature specifically needs
an embedding (WASI, JS string builtins or shared memory).

The corpus CI workflow rebuilds these sources, checks that artifact bytes match
on Linux, and reruns V8 correctness. Compiler binary hashes in recipe metadata
can differ by host; artifact reproducibility is checked separately.

## Execute the complete selected inventory

```sh
just corpus-v8-check          # imports the exact configured upstream contracts
just applications-check      # V8 and Wasmtime for every local C kernel
WASMBENCH_RUNTIMES=wasmtime just features-check
just corpus-source-check     # rebuild seven retained WAT workloads and check adapters
```

`corpus-v8-check` writes `.wasmbench/corpus-v8-check.json`. It runs each workload
in its own process with a 30-second timeout, tests three fresh instances, and
also tests repeated calls for stateless workloads. It checks exact return values,
full byte vectors, declared memory output, stream SHA-256 and exit codes. Every
file-backed input is checked against its digest and staged in a fresh directory.
Node's WASI host uses a recorded `LANG=C.UTF-8` environment: old Clang rejects an
empty environment, and tree's Unicode output depends on locale. This is a
correctness check; it collects no performance measurements. Normal corpus checks
and collection run this V8 gate before adapter execution or timing for the
configured application and feature suites.

V8's native WebAssembly API executes core modules. Node's `node:wasi` supplies
Preview 1 imports. Components and Preview 2 remain explicitly unavailable in
this V8 report; use Wasmtime to execute them. Compilation-only async probes must
never be described as executed async workloads. Unsupported proposals in an
adapter's locked configuration remain unsupported rather than passing.

The WASI feature fixtures cover scalar and scatter/gather output, nonuniform
stdin bytes, EOF, arguments including their contents and null terminators,
preopened file access and seeking, monotonic clocks, and random-call errno.
The randomness probe checks the interface result, not entropy quality. Negative
host tests prove that missing reads, missing argument strings and missing write
byte counts fail.

## Retained upstream sources

`upstream/wago/` includes 160 original source, wrapper, build, fixture and license
files for the selected upstream inventory. `upstream/sources.json` pins their
SHA-256 values, Wago revision, dependency provenance and recipe paths. Refresh
intentionally with `just corpus-sources-refresh`, then review the changes.

For example, edit a retained library wrapper and rebuild with its pinned upstream
library revision:

```sh
cd corpora/upstream/wago
mkdir -p corpus/workloads/synthetic corpus/workloads/compute
sh corpus/build/wat.sh
WASI_SDK=/path/to/wasi-sdk-34 UPDATE=1 sh corpus/workloads/semantic/kissfft/build.sh
# Other libraries follow their own retained build.sh and README requirements.
```

The compiler can be WASI SDK while the resulting module is still import-free.
Library recipes fetch dependencies at pinned commits; `.tmp/upstream/` contains
the editable dependency checkouts after a build. Full command recipes document
their source checkout and SDK requirements. Keep modified sources and update
contracts only after checking an independent oracle; do not derive expected
values from the candidate Wasm.

Some existing upstream entries are release artifacts without an exact source
rebuild recipe: Ruby, uutils/coreutils, a-Shell ripgrep and json2csv, and YoWASP
hardware tools. Clang and Lua recipes transform release binaries, and Swift's
recipe fetches a release binary. These limitations are recorded as
`release-artifact-only` or `fetch-or-transform` in the source inventory. They are
V8 execution checked, but their source builds are not claimed reproducible.
The original 102 local kernels and all feature sources have complete builds.

References: [Node WASI API](https://nodejs.org/api/wasi.html),
[WASI Preview 1](https://github.com/WebAssembly/WASI/tree/main/legacy/preview1),
[wasm-tools](https://github.com/bytecodealliance/wasm-tools).
