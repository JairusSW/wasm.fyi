# LibWasm JIT adapter research (2026-10-23)

## Finding

Ladybird's LibWasm now has its own optimizing JIT. It is not the older,
out-of-process Cranelift experiment: the current engine links the in-tree Rust
`libwasm_jit` crate directly, and the runtime tiers between its interpreter and
native code.

The upstream sequence landed on 2026-10-21/22:

- [`4dee23d4`](https://github.com/LadybirdBrowser/ladybird/commit/4dee23d4f34b04aaf37aabdf81a05ed9fc6b5805)
  added the optimizing compiler.
- [`8f28e19e`](https://github.com/LadybirdBrowser/ladybird/commit/8f28e19e695de2e40e96a10fecebbe7783928a45)
  connected compiled code to the runtime and added hot-function tiering.
- [`4cd3e031`](https://github.com/LadybirdBrowser/ladybird/commit/4cd3e0319cb93f2e3fcf7ef3a6b6b74d7a6baf9c)
  added SIMD, GC, atomics, and exception compilation.
- [`f19b99fe`](https://github.com/LadybirdBrowser/ladybird/commit/f19b99fe426198b2eb46f57bd00e00caea86cc03)
  enabled the JIT by default.
- [`9e6129ee`](https://github.com/LadybirdBrowser/ladybird/commit/9e6129ee0c6befc0f3a56cbf32b6e4a2bf14a8e9)
  added AArch64 code generation.

The source was inspected at Ladybird master `293ee18d76cbd2f85ac334f19c82c3865d57022a`.

## Build and platform support

There is no JIT-specific CMake option in the current implementation. LibWasm's
CMake target imports `Engine/Cargo.toml`, and that engine has an unconditional
path dependency on `libwasm_jit`. Therefore the existing adapter build must be
updated for the new Rust-backed LibWasm API/build, but it does not need a
separate `ENABLE_*_JIT` switch. See the current
[LibWasm CMake target](https://github.com/LadybirdBrowser/ladybird/blob/293ee18d76cbd2f85ac334f19c82c3865d57022a/Libraries/LibWasm/CMakeLists.txt#L1-L10)
and [engine dependencies](https://github.com/LadybirdBrowser/ladybird/blob/293ee18d76cbd2f85ac334f19c82c3865d57022a/Libraries/LibWasm/Engine/Cargo.toml#L11-L21).

The runtime enables native execution only on Linux or macOS on x86-64 or
AArch64. Other targets retain the interpreter. Executable-memory availability
is also checked at runtime, so a hardened process without the needed JIT
entitlement falls back rather than proving native execution. This is explicit
in the [platform gate](https://github.com/LadybirdBrowser/ladybird/blob/293ee18d76cbd2f85ac334f19c82c3865d57022a/Libraries/LibWasm/Engine/src/runtime/jit.rs#L121-L126)
and [runtime enablement check](https://github.com/LadybirdBrowser/ladybird/blob/293ee18d76cbd2f85ac334f19c82c3865d57022a/Libraries/LibWasm/Engine/src/runtime/jit.rs#L272-L281).

## Selecting a benchmark mode

The public embedding calls do not select a tier. Selection is process-wide via
the `LIBWASM_JIT` environment variable, parsed once. Upstream documents these
relevant values in
[`runtime/jit.rs`](https://github.com/LadybirdBrowser/ladybird/blob/293ee18d76cbd2f85ac334f19c82c3865d57022a/Libraries/LibWasm/Engine/src/runtime/jit.rs#L20-L33):

- `off`: interpreter only.
- `on`: default hot-function tiering, threshold 1000.
- `forced`: compile synchronously at the first call or loop.
- `eager`: compile all functions during instantiation.
- `sync`: compile on the invoking thread.
- `threads=N`: set background compile-thread count. With no override, upstream
  uses available parallelism minus one, with a minimum of one
  ([implementation](https://github.com/LadybirdBrowser/ladybird/blob/293ee18d76cbd2f85ac334f19c82c3865d57022a/Libraries/LibWasm/Engine/src/runtime/jit.rs#L1063-L1107)).
- `perf-map`: emit `/tmp/perf-PID.map` entries for generated functions.

wasm.fyi exposes the two user-facing execution policies separately:

- `libwasm`: `off`.
- `libwasm-jit`: `on,threads=1`, preserving normal hot-function tiering.

The fixed thread count makes captures reproducible. Forced/eager compilation,
threshold overrides, verification, perf-map collection, and the two OSR stress
switches remain diagnostic modifiers rather than benchmark configurations.
Upstream confirms eager compilation happens during instantiation in
[`instantiated()`](https://github.com/LadybirdBrowser/ladybird/blob/293ee18d76cbd2f85ac334f19c82c3865d57022a/Libraries/LibWasm/Engine/src/runtime/jit.rs#L285-L292).

Consequences for wasm.fyi metrics:

- The ordinary module-compile API still parses/validates/quickens the module;
  eager native compilation occurs during instantiation. If wasm.fyi wants its
  `compile` metric to mean validation plus native compilation, the adapter must
  deliberately attribute eager instantiation's compilation portion rather than
  silently reporting only parse/validation time.
- `forced` is unsuitable for clean first-call measurements because it includes
  synchronous JIT compilation in that call.
- Keep the existing interpreter configuration explicit with
  `LIBWASM_JIT=off`; the upstream default is now JIT-on.

## Native-code accounting and limitations

With `perf-map`, LibWasm records an address and exact byte length for every
installed compiled function, including OSR variants. Summing the
`wasm-function-*` entries is a practical adapter-visible native-code metric;
runtime entry/adapter stubs have separate names and should not be charged to
the module. The write site uses `compiled.code.len()` in
[`StoreJit::finish`](https://github.com/LadybirdBrowser/ladybird/blob/293ee18d76cbd2f85ac334f19c82c3865d57022a/Libraries/LibWasm/Engine/src/runtime/jit.rs#L1248-L1266).

Upstream says the JIT compiles every validating function, including SIMD, GC,
atomics, and exceptions. The documented exceptional case is OSR into a loop
inside a legacy catch handler; that frame remains interpreted. See the
[architecture overview](https://github.com/LadybirdBrowser/ladybird/blob/293ee18d76cbd2f85ac334f19c82c3865d57022a/Libraries/LibWasm/JIT/ARCHITECTURE.md#L14-L35).

The generated code is per store and is reclaimed with dead modules. Peak RSS
therefore needs to cover eager instantiation, and code-size collection must
read the perf map while the store/module remains alive. The ownership model is
described in the
[runtime architecture](https://github.com/LadybirdBrowser/ladybird/blob/293ee18d76cbd2f85ac334f19c82c3865d57022a/Libraries/LibWasm/JIT/ARCHITECTURE.md#L335-L370).

## Adapter acceptance checks

1. Build the exact pinned Ladybird revision using the current Rust-backed
   LibWasm target.
2. Run the same workload with `LIBWASM_JIT=off` and
   `LIBWASM_JIT=eager,sync,threads=1`; verify identical oracle results.
3. Enable `perf-map` for a probe and require at least one
   `wasm-function-*` entry before identifying a capture as `libwasm-jit`.
4. Keep interpreter and JIT as separate configuration IDs and backend labels.
5. Test both amd64/Linux and arm64/macOS, the two wasm.fyi host combinations
   covered by upstream's native-code gate.
