# Import-free tooling replacements

These are new workloads, not claims that the original command-line programs have
been compiled unchanged. Filesystem, process startup and command parsing are not
timed. `run` performs the actual algorithm each time and releases its temporary
state; `reset` is an explicit no-op because calls are self-contained.

| Former workload | Replacement | Retained work and semantic change |
| --- | --- | --- |
| clang-cpp-kernels | wasm-tools-assemble-validate | Real WAT parser, Wasm encoder, and complete binary validator. 96 generated functions, structured loops, globals, memory, table and data. This is WebAssembly assembly/validation, **not C++ compilation**. |
| swift-format-source | tree-sitter-swift-parse | Actual generated Swift grammar, external scanner and tree-sitter runtime parse structs, protocols, enums, generics, closures and extensions 24 times and traverse every syntax node. **No Swift formatting**. |
| esbuild-minify | oxc-js-minify | Actual Oxc JavaScript parser, semantic analysis, compression, identifier mangling, and code generation over 48 source functions. **Not esbuild**, bundling and file resolution excluded. |
| yosys-counter | abc-isop-minimize | ABC's actual Morreale irredundant sum-of-products minimization, trying both output polarities, for 12 ten-input truth tables. Every synthesized cover is checked for all 1,024 assignments. **Not Verilog elaboration or the full Yosys flow**. |
| icemulti-image | icestorm-multiboot-memory | Actual image alignment, five multiboot headers, padding and four images, selecting power-on image 2 and 4 KiB alignment. File streams replaced by bounded memory writes. |
| icepack-pack | icestorm-bitstream-memory | Full upstream write_bits algorithm including command framing, four CRAM banks, four BRAM banks, CRC-16-CCITT, wakeup and padding. Configuration is generated directly in memory, **ASCII parsing excluded**. |
| ecppll-clock | trellis-pll-search | Exact upstream divider search and VCO tie-breaking for 11 clock pairs. **CLI parsing and Verilog formatting excluded**. |

## Pinned inputs

- IceStorm: https://github.com/YosysHQ/icestorm at
  `45f5e5f3889afb07907bab439cf071478ee5a2a5`, ISC.
  icemulti.cpp retains align_offset, write_byte, write_bytes, write_header with a
  MemoryOutput sink and memory Image descriptor. icepack.cpp retains
  update_crc16, write_byte and the entire FpgaConfig::write_bits body. Fixed-capacity
  containers replace std::vector/string dependencies; bounds fail with Wasm traps.
- Project Trellis: https://github.com/YosysHQ/prjtrellis at
  `35f5affe10a2995bdace49e23fcbafb5723c5347`, ISC. ecppll.cpp extracts
  calc_pll_params and calc_pll_params_highres, with the unused strings removed
  from records; numeric_limits<float>::max becomes its exact binary32 literal and
  fabsf becomes the compiler intrinsic. Timed workload uses the normal search.
- ABC: https://github.com/berkeley-abc/abc at
  `a3001b72edc5de22442e942165487fddf150e3d0`, permissive Berkeley ABC license
  (LicenseRef-ABC-Berkeley; full verbatim notice in licenses/abc.txt).
  Unmodified kitIsop.c and kitTruth.c plus upstream headers are source-built.
- tree-sitter runtime: https://github.com/tree-sitter/tree-sitter at
  `8261cea5e5098ad4b88f234dbaa224a916a34af3`, MIT (bundled Unicode notices apply).
  Only optional logger/Graphviz diagnostics are disabled; allocation failure traps
  rather than printing/aborting through libc. No system-call replacements exist.
- Swift grammar: npm tree-sitter-swift 0.7.1, MIT; archive SHA-256
  `abd89284f1b0f1375ba5efaa9ddf99ad4b16ac91fc7751ef10c5f013cca06f8c`.
  Scanner `1UL << FAKE_TRY_BANG` becomes `UINT64_C(1) << FAKE_TRY_BANG` to
  preserve the intended 64-bit mask on wasm32 (upstream unsigned long is 64-bit
  on the native reference host).
- wat 1.239.0 + wasmparser 0.239.0 (wasm-tools), Apache-2.0 WITH LLVM-exception
  OR Apache-2.0 OR MIT; Oxc 0.75.0, MIT. Cargo.lock pins every transitive source
  and registry checksum. Rust 1.90.0, wasm32-unknown-unknown release/LTO.

## Independent oracles and verification

Expected values are committed, never learned from the candidate Wasm at build time.

- icemulti: original native CLI `-A12 -p2` produces 45,683 bytes; FNV-1a
  `3294422427`. Four deterministic images have lengths 1021,8193,4099,17011.
- icepack: original unmodified upstream class, called from icepack-reference.cpp
  using real std::vector/std::ostringstream, produces 32,216 bytes;
  FNV-1a `2918599611`. The memory port is independently compared with it.
- Trellis: native extraction returns divider-record digest `1792084035`;
  the documented exact-frequency examples include 12→48,20→30,45→30,100→400,
  70→40,12→96,90→50,43→86. All selected VCOs are checked for legal bounds.
- ABC: native library/wrapper yields `1213771677`, in addition to exhaustive
  independent cover evaluation inside every invocation.
- Swift: **unmodified** native tree-sitter runtime + native Swift scanner yields
  `664666373`; every Wasm tree must be error-free and exceed 100 syntax nodes.
- Oxc: native Rust reference yields 6,871 bytes with FNV-1a `3819475620` from a
  19,342-byte input. Original and minified JavaScript independently execute in
  Node and both set result=1414016970.
- Wasm-tools: native Rust reference binary FNV-1a `1659816563`; the generated
  binary is separately instantiated in Node and its exported function checked.

The build helper rejects **any imports**, checks committed oracles on repeated
calls before/after reset, and records full source and changed-semantics provenance.
SDK libc may supply dead-stripped memory primitives; it supplies no WASI ABI.
