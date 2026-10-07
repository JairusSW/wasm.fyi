# Corpus sources and correctness

Every configured corpus artifact has a source build: 166 application algorithms
in 27 categories and 290 feature contracts. The application inventory contains
102 original import-free C kernels, 43 retained core upstream workloads, and
21 import-free library/runtime replacements for former WASI commands. Each
category has 6–9 distinct algorithms. Feature probes are counted separately.

The main inventory has no WASI commands or Emscripten modules. All guest inputs
and outputs are in memory. See [the full replacement mapping and explicit scope
changes](nonwasi/README.md). Feature/conformance WASI tests remain separate.

The DNA/text kernels replacing
six Emscripten defaults are original implementations; they do not claim to run
seqtk, FastTree or GNU sed.

## Build everything

The source workflow validates original kernels, pinned upstream libraries, feature
modules/components and the separately generated host-call fixtures. Per-build
input manifests and CI reports identify the exact tested commit and toolchains.
Independent contracts establish correctness only for their specified workloads;
source builds do not create or rewrite performance measurements.

Prerequisites:

- Node **26.4.0**, with V8 **14.6.202.34-node.21**.
- LLVM Clang **22.1.8** for the original C kernels.
- Rust **1.90.0**, Cargo and `wasm32-unknown-unknown` for the new core libraries.
  The feature/component source workflow additionally uses Rust **1.98.1** and
  its `wasm32-unknown-unknown` / `wasm32-wasip1` targets.
- Go **1.26.5** with automatic toolchain selection for the benchmark harness audit.
- `wasm-tools` **1.260.0**, Wasmtime **46.0.1**, WABT, CMake, Ninja, make, Git,
  curl, tar and unzip.
- A native C/C++ compiler, Ruby and Rake for mruby's bundled parser/build tools.
  Docker is no longer required by any main-corpus workload.

Use the Rustup toolchain (the Homebrew Rust distribution cannot use these
Rustup target libraries). For Rust:

```sh
rustup toolchain install 1.90.0 --profile minimal --target wasm32-unknown-unknown
# Needed only for the separate feature/component source build:
rustup toolchain install 1.98.1 --profile minimal \
  --target wasm32-unknown-unknown,wasm32-wasip1
export PATH="$HOME/.cargo/bin:$PATH"
export RUSTUP_TOOLCHAIN=1.90.0
```

Set `WASMBENCH_CLANG` / `WASMBENCH_WASM_TOOLS` if those binaries are outside their
default locations. `node scripts/llvm-toolchain.mjs` installs the pinned LLVM
archive on Linux x64. The build installs the digest-pinned WASI SDK 34 compiler
in the workspace. It downloads source dependencies on the first build.

```sh
just corpus-main-build      # all 166 main algorithms, import checks, oracles, catalog
just corpus-main-check      # recheck all built main modules without rebuilding
just corpus-build-all       # also build/check the separate feature/component corpus
```

This compiles all original kernels, all feature modules/components, the WASI
component adapter, and all selected upstream applications/libraries. No corpus
executable is fetched from a binary release. It checks core/Preview 1 contracts
in V8 and component contracts in Wasmtime before reporting success. Async type
probes are explicitly checked for compilation only.

The retained upstream builds run in an initially empty directory under
`.wasmbench/source-builds/`. Each build retains source checkouts,
input digests, artifact digests, individual V8 checks and a report. A missing
recipe, compile failure or output mismatch fails the command. Partial builds
never publish the default corpus.

A successful complete upstream build publishes
`.wasmbench/upstream/manifest.json`. Normal corpus preparation and measurement
use those locally compiled artifacts. No separate Wago checkout is required to
build or verify the source corpus. The full command refreshes the prepared
inventory after verification. The main-only audit needs no harness. For the full audit and its host-call fixtures,
the all-corpus command uses `WASMBENCH_ROOT` / the configured harness checkout when present, or fetches
the pinned `harnessSource` from `wasmbench.config.json`. Collection uses the
same wasm-bench harness.

For a focused rebuild:

```sh
just corpus-main-rebuild serde-json2csv,lua-memory-buckets
just applications-build      # all 102 C kernels
just features-build          # all 135 feature artifacts / 290 contracts
just corpus-wat-build        # seven retained WAT workloads
```

The full source workflow in `.github/workflows/corpus.yml` exercises the same
command on Linux and retains verification reports.

### Historical command recipes

The retired WASI CLI recipes remain as provenance. Their older native/Docker
toolchain instructions are retained in [the archived build guide](upstream/ports/LEGACY.md).
Current main-corpus commands select only the import-free replacements and need
none of those legacy compiler or container routes.

## Edit the sources

- Original kernels: `applications/sources/kernels.c`, with independent reference
  algorithms in `../scripts/lib/application-kernels.mjs`.
- Features: `features/generator.mjs`; rebuild to update the checked-in WAT,
  artifacts and manifests.
- Retained WAT/Rust/library wrappers: `upstream/wago/corpus/sources/` and
  `upstream/wago/corpus/workloads/semantic/`. After reviewing an edit, run
  `node scripts/corpus-source-inputs.mjs --refresh` to re-pin source digests.
- Complete upstream source trees: each build retains them in `tree/.tmp/`.
  Save source edits as patches under `upstream/patches/`; see its README.
- Active import-free replacements: `nonwasi/` and `../scripts/nonwasi-*.mjs`.
  These embed actual pinned upstream libraries/interpreters; see each group's
  notices and scope documentation. Legacy CLI sources/ports remain historical
  provenance only and are never selected by the active source builder.

The Preview 1 to Preview 2 adapter is compiled from Wasmtime **46.0.1** source
at revision `823d1b8f251494a06288194d0df746191f535ff7`, using Rust **1.98.1**. Its
structural verifier runs before `wasm-tools component new` incorporates it into
feature modules. `../scripts/feature-adapter-source.mjs` records this build.

`upstream/sources.json` pins 162 retained source/wrapper/fixture/license files,
the original Wago revision and historical recipes, plus the active replacement mapping. `upstream/contracts.json`
retains independent exact contracts without depending on a Wago checkout.
Historical fetch/transform scripts are provenance; the active build is
`corpus-rebuild.mjs`. `just corpus-sources-refresh` intentionally refreshes the
original snapshot from Wago; it is not needed when editing retained sources.

Do not derive expected outputs from the candidate Wasm. Check behavior against
an independent algorithm or trusted native/reference execution before changing
an oracle.

## Execute and verify

```sh
just corpus-v8-check
node scripts/corpus-components-check.mjs
just applications-check
WASMBENCH_RUNTIMES=wasmtime just features-check
```

The V8 checker isolates each workload in a process with a 30-second timeout.
It checks three fresh instances and repeated calls for stateless workloads,
exact return values, full byte vectors, memory output, stream SHA-256 and exit
codes. File inputs are digest-checked and staged in fresh directories. Node's
WASI feature host uses `LANG=C.UTF-8`. Main-corpus modules have no WASI host
contract. Checks collect no performance measurements.

V8 executes core modules; `node:wasi` supplies Preview 1 imports. V8 has no
native Component Model API, so its report marks components unavailable.
Wasmtime checks their exact results and Preview 2 command output separately.
The site matches feature results to the current artifact digest; changed probes
await new measurements. Archived results remain preserved. Unsupported
proposals in an adapter's locked configuration remain unsupported.

WASI fixtures cover scalar and scatter/gather output, nonuniform stdin, EOF,
argument contents and null terminators, preopened file access/seeking,
monotonic clocks, and random-call errno. The random probe checks the interface
result, not entropy quality. Negative host tests reject missing reads, missing
argument strings and missing write counts.

## Curated feature execution and upstream semantics

The feature inventory now includes 49 additional execution contracts in 16
shared, multi-export modules. All 21 execution-capable feature families have
at least five distinct operation families, excluding scalar baselines and
size-only variants. Validation, extended-constant initialization and async
component type construction remain structural/compile-only workloads.

See [feature curation](features/CURATION.md) for the operation inventory,
execution-only timing command, independent-oracle checks, pinned upstream
assertions and attribution. Upstream semantic assertions run separately and
are never timed as benchmark kernels.
