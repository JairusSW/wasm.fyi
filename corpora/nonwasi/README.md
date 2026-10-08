# Import-free main-corpus replacements

The main corpus now contains 166 algorithms: 102 original C kernels, 43 retained
core upstream workloads, and 21 replacements for the former WASI command
workloads. There are still 27 categories, with 6–9 distinct algorithms each.
The replacements use new contract IDs. Historical measured data is not rewritten
or presented as measurements of these new programs.

`just corpus-main-build` builds all 166 from source, checks their independent
oracles, rejects WASI/host-I/O imports, and regenerates the prepared catalog.
`just corpus-main-check` repeats admission/execution checks on the built outputs.
`just corpus-main-rebuild lua-memory-buckets,sqlite-memory-query` builds a subset
without publishing a partial default manifest. `just corpus-build-all` additionally
builds and checks the separate feature/component corpus, including its WASI tests.

## What changed

All IDs below have the `wago/` prefix. These are explicit workload substitutions,
not claims that whole command-line programs were simply recompiled unchanged.

| Previous command | Core replacement | Retained work / scope change |
| --- | --- | --- |
| ruby-buckets | mruby-memory-buckets | Actual mruby parses/executes the original Ruby bucket program; CRuby and CLI setup excluded |
| lua-cli-buckets | lua-memory-buckets | Actual Lua parses/executes the original million-event program; I/O/OS libraries excluded |
| quickjs-script | quickjs-memory-events | Actual QuickJS parses/executes original event/regexp/ranking program; CLI/host modules excluded |
| clang-cpp-kernels | wasm-tools-assemble-validate | Real WAT assembly and binary validation; C++ compilation replaced |
| swift-format-source | tree-sitter-swift-parse | Real Swift grammar/scanner and syntax-tree traversal; formatting excluded |
| esbuild-minify | oxc-js-minify | Real JS parsing, semantic analysis, compression, mangling and codegen; bundling excluded |
| yosys-counter | abc-isop-minimize | Actual ABC Boolean-cover minimization with exhaustive truth-table checks; Verilog synthesis replaced |
| icemulti-image | icestorm-multiboot-memory | Actual image placement, headers, alignment/padding; bounded memory replaces files |
| icepack-pack | icestorm-bitstream-memory | Actual CRAM/BRAM serialization, framing and CRC; ASCII parsing and files excluded |
| ecppll-clock | trellis-pll-search | Actual divider search and VCO tie-breaking; CLI/Verilog output excluded |
| coreutils-sort | rusttext-sort | Rust stable UTF-8 line sorting; CLI and locale handling excluded |
| coreutils-base64 | base64-rfc4648 | Actual base64 crate standard/URL-safe encode/decode; full output checked |
| coreutils-wc | unicode-wordcount | Text counts plus real Unicode grapheme segmentation; in-memory input |
| ripgrep-source | regex-source-scan | Actual Rust regex searches and complete match spans; filesystem traversal excluded |
| json2csv-people | serde-json2csv | Real serde_json and csv parsing/serialization with escaped/Unicode fields |
| jq-json-transform | jaq-json-query | Real jaq jq-language parser/compiler/interpreter across multiple queries; different engine |
| tree-list | zip-directory-extract | Real ZIP directory traversal and CRC-checked extraction; archive instead of host directory |
| age-keygen-public | x25519-public | Actual X25519 public-key derivation, cross-checked with Node crypto; entropy/Bech32 excluded |
| brotli-compress | brotli-memory-roundtrip | Actual Brotli quality-10 compression/decompression; Wasm stream independently decoded by Node |
| xzdec-decompress | xz-memory-decode | Actual liblzma checks and decodes the original retained stream in memory |
| sqlite3-query | sqlite-memory-query | Actual SQLite inserts, queries, commit/rollback, and aggregation in a memory-only database |

The 21 new modules have zero imports. The retained AssemblyScript core kernels
may import their declared fail-closed `env.abort` callback. No main module may
import WASI, filesystem, environment, clocks, entropy, or arbitrary host glue.
SDK libc is used only where the linker eliminates host-dependent paths. Memory
allocators and bounded in-memory adapters implement real functionality. Fatal
errors trap; none of the adapters pretend a syscall succeeded. Runtime/library
restrictions and extracted portions are documented in each group's source notes.

## Source and correctness evidence

- `replacements.json` is the exact one-to-one migration inventory.
- Each group contains editable wrappers, pinned dependency definitions, independent
  reference/oracle inputs, and upstream license notices. Rust Cargo.lock files pin
  the entire transitive dependency graph; external archives have SHA-256 pins and
  Git checkouts use full commit IDs.
- `scripts/nonwasi-*.mjs` compile real source, inspect imports, and compare results
  against independent Node/native oracles. Candidate Wasm output is never used to
  invent expected values. Full byte comparisons supplement runner checksums.
- The complete source build starts from a new staging tree, records local input
  digests and fetched source identities, and refuses to publish if any snapshotted
  input changes while compilation is running. Compiled binaries are never fetched
  as workload inputs. Downloaded SDKs are compiler dependencies only.
- Repeated same-instance calls are checked. Interpreter creation, parsing,
  execution, output processing, and teardown are part of the workload function;
  compilation/instantiation and filesystem setup are outside its execution body.
- New source/artifact hashes and IDs prevent silently associating old CLI timing
  evidence with these new contracts. No performance improvement is claimed here.

The `hifijson` dependency declares MIT but supplies no license-text file in the
pinned distribution; that absence is recorded explicitly in the text inventory.
