# Corpus sources and correctness

Every configured corpus artifact has a source build: 166 application algorithms
in 27 categories and 290 feature contracts. The application inventory contains
102 original import-free C kernels and 64 retained upstream workloads. Each
category has 6–9 distinct algorithms. Feature probes are counted separately.

The default inventory has no Emscripten modules. The DNA/text kernels replacing
six Emscripten defaults are original implementations; they do not claim to run
seqtk, FastTree or GNU sed.

## Build everything

### Recorded verification and limits

As of 2026-10-07, recorded individual source-build runs cover all configured
corpora: 102 original C kernels, 135 feature artifacts, all 64 upstream workload
IDs, and both host-call fixtures. Those runs checked their retained correctness
contracts; the feature build includes the source-built WASI component adapter.
CoreMark completed in a separate final run using its unchanged recipe and oracle.

A fresh end-to-end `corpus-build-all` run, its final aggregate audit, and the full
GitHub Actions workflow have not passed as one combined run. The default Docker
paths have not been verified in these runs; the large Ruby, Yosys and Swift ports
were verified through the documented native Linux paths. Individual build
results do not imply arbitrary-program correctness or historical performance
results. The commands below describe the reproducible build workflow, rather
than claiming aggregate CI is already green.

Prerequisites:

- Node **26.4.0**, with V8 **14.6.202.34-node.21**.
- LLVM Clang **22.1.8** for the original C kernels.
- Rust **1.98.1**, Cargo and the `wasm32-unknown-unknown` / `wasm32-wasip1` targets.
- Go **1.26.5** with automatic toolchain selection enabled; age selects **1.27.0**.
- `wasm-tools` **1.260.0**, Wasmtime **46.0.1**, Binaryen **130** (`wasm-opt`),
  WABT, CMake, Ninja, make, Git,
  curl, tar and unzip.
- Docker by default. The large Ruby, Yosys and Swift ports use pinned Linux
  toolchains; optional [native Linux builds](#native-linux-builds-for-the-large-ports)
  use the same target compilers.
  Allow Docker 12 GB of memory for Yosys linking. Linux x64 is recommended for
  the complete build; Mac hosts can build the other modules natively and run
  these ports in Docker.

Use the Rustup toolchain (the Homebrew Rust distribution cannot use these
Rustup target libraries). For Rust:

```sh
rustup toolchain install 1.98.1 --profile minimal \
  --target wasm32-unknown-unknown,wasm32-wasip1
export PATH="$HOME/.cargo/bin:$PATH"
export RUSTUP_TOOLCHAIN=1.98.1
```

Set `WASMBENCH_CLANG` / `WASMBENCH_WASM_TOOLS` if those binaries are outside their
default locations. `node scripts/llvm-toolchain.mjs` installs the pinned LLVM
archive on Linux x64. The build installs the digest-pinned WASI SDK 34 compiler
in the workspace. It downloads source dependencies on the first build.

Lua requires exactly Binaryen 130 to translate its legacy exception encoding.
Set `WASM_OPT` if `wasm-opt` is outside `PATH`. To build that tool from pinned
source, run the following in an empty working directory (CMake, Ninja and a
C++ compiler are required). CI uses the same revision and commands:

```sh
git init binaryen-130-source
git -C binaryen-130-source remote add origin https://github.com/WebAssembly/binaryen.git
git -C binaryen-130-source fetch --depth=1 origin 5d704ad52bc77a258e8fa3f9d34fcc5e8799c1c3
git -C binaryen-130-source checkout --detach FETCH_HEAD
cmake -S binaryen-130-source -B binaryen-130-build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF
cmake --build binaryen-130-build --target wasm-opt --parallel 2
export WASM_OPT="$PWD/binaryen-130-build/bin/wasm-opt"
"$WASM_OPT" --version  # must report wasm-opt version 130
```

```sh
just corpus-build-all        # also available as just corpus-build
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
inventory after verification. For that audit and its host-call fixtures, it
uses `WASMBENCH_ROOT` / the configured harness checkout when present, or fetches
the pinned `harnessSource` from `wasmbench.config.json`. Collection uses the
same wasm-bench harness.

For a focused rebuild:

```sh
node scripts/corpus-rebuild.mjs --ids=json2csv-people,lua-cli-buckets
just applications-build      # all 102 C kernels
just features-build          # all 135 feature artifacts / 290 contracts
just corpus-wat-build        # seven retained WAT workloads
```

The full source workflow in `.github/workflows/corpus.yml` exercises the same
command on Linux and retains verification reports.

### Native Linux builds for the large ports

Docker remains the default for Ruby, Yosys and Swift. Linux x86_64 hosts can
opt into native builds with the same pinned target compilers, source revisions,
optimization flags and output contracts. The toolchain archives can live in a
user-writable directory; no daemon or system configuration change is required.

For Ruby and Yosys, install these additional host tools: Ruby (including its
`ripper` standard library), GNU make, a C++ compiler, Python 3, bison, flex,
gawk, autoconf, gperf and ccache. Native verification used Ruby 3.3.8,
autoconf 2.72, bison 3.8.2, flex 2.6.4 and gperf 3.2.1. Install
[WASI SDK 19](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-19)
(Clang 15.0.7) and
[Binaryen 108](https://github.com/WebAssembly/binaryen/releases/tag/version_108).
The SDK archive SHA-256 is pinned in `upstream/ports/legacy/Dockerfile`.
The legacy scripts reject a different compiler version; Ruby also checks
Binaryen 108. Keep SDK 34 available for the other source builds.

For Swift, install the official Linux x86_64 Swift **6.3.3** toolchain from
[Swift's previous releases](https://www.swift.org/install/linux/ubuntu/24_04/).
The native recipe checks the compiler version and Linux target, installs the
checksum-pinned matching Wasm SDK when missing, and uses the retained
`Package.resolved`. It keeps the release build and two-job limit. The Apple
Swift compiler is not supported for this port.

```sh
export PATH="/path/to/binaryen-version_108/bin:/path/to/swift-6.3.3/usr/bin:$PATH"
export WASMBENCH_NATIVE_LEGACY=1
export WASMBENCH_LEGACY_WASI_SDK=/path/to/wasi-sdk-19.0
export WASMBENCH_NATIVE_SWIFT=1
export WASMBENCH_SWIFT=/path/to/swift-6.3.3/usr/bin/swift
# Lua needs Binaryen 130 even while Ruby finds Binaryen 108 on PATH.
export WASM_OPT=/path/to/binaryen-version_130/bin/wasm-opt
node scripts/corpus-rebuild.mjs --ids=ruby-buckets,yosys-counter,swift-format-source
# Or, with every prerequisite installed:
just corpus-build-all
```

For entirely user-space installations, host Ruby must still find its standard
library when `RUBYLIB` is cleared by Ruby's build system; use a normally installed
Ruby or a launcher with explicit `-I` library paths. Relocated autoconf packages
also need their executable and macro-data paths configured. SwiftPM's
`XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `XDG_DATA_HOME` should point to writable
locations. Native mode does not reduce Yosys's linking memory requirements;
reserve sufficient RAM and avoid overlapping large links.

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
- Compiler ports and pinned toolchains: `upstream/ports/` and
  `../scripts/corpus-rebuild.mjs`. These include source builds for Ruby, Clang,
  Lua, coreutils, ripgrep, JSON-to-CSV, Yosys, IcePack, IceMulti, ECPPLL and Swift
  formatter, replacing the former binary-only recipes.

The Preview 1 to Preview 2 adapter is compiled from Wasmtime **46.0.1** source
at revision `823d1b8f251494a06288194d0df746191f535ff7`, using Rust **1.98.1**. Its
structural verifier runs before `wasm-tools component new` incorporates it into
feature modules. `../scripts/feature-adapter-source.mjs` records this build.

`upstream/sources.json` pins 162 retained source/wrapper/fixture/license files,
the original Wago revision and historical recipes. `upstream/contracts.json`
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
WASI host uses `LANG=C.UTF-8`; old Clang rejects an empty environment and tree's
Unicode output depends on locale. Checks collect no performance measurements.

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
