# Archived WASI command build instructions

These instructions apply to commit `30057ea1e67ea8f1a7cde0e672814e43b68d78cd`,
before the main-corpus migration to import-free replacements. Use a separate
checkout of that revision to reproduce these historical command workloads.
They are not prerequisites or active IDs for the current main corpus.
See [the current source workflow](../../README.md) for active commands.

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
