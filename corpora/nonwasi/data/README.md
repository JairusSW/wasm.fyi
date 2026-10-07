# In-memory upstream data engines

These are new workload contracts, not rewrites of the old command-line scores.
They compile genuine pinned SQLite, Brotli and XZ Utils library sources. The
build rejects every WebAssembly import and tests three calls on one instance.

- `wago/sqlite-memory-query`: SQLite 3.53.4, 10,000 stored rows, recursive SQL
  generation, commit and rollback, four aggregate results. A supported
  `SQLITE_OS_OTHER` memory-only VFS refuses file opening. Its deterministic
  benchmark randomness is not suitable for security. Each call closes the
  database and shuts down SQLite; no host storage or clock is used.
- `wago/brotli-memory-roundtrip`: Brotli v1.2.0, 64 KiB generated input, quality
  10 encoding, real decoding, exact byte comparison, and full output checksum.
  A compression-size assertion also rejects a pass-through implementation.
  The build additionally decodes the Wasm-generated stream with Node zlib
  and compares every byte with the independent generated reference.
- `wago/xz-memory-decode`: XZ Utils pinned 5.8.4 source, the original 556-byte
  corpus XZ stream, liblzma integrity checks and complete stream consumption.
  The output is 1,010 bytes; independently decoded with Python `lzma`, its
  SHA-256 is `15f4817d6bb6e105ef12c8b6d2383c32d1646a16824365d96935445f436afc89`
  and FNV-1a-32 is `1888774247`.

SQLite and Brotli expected checksums are calculated independently in JavaScript.
The returned i32 checksum is interpreted as unsigned by the exact-u64 contract.
Fatal allocation/invariant failures trap; no fake WASI syscalls are linked.
The SDK is only a compiler/static C library provider. Its use does not imply
that a module has a WASI ABI.

Wrappers are MIT-licensed; see LICENSE in this directory. Upstream licenses are
SQLite public domain, Brotli MIT and XZ Utils 0BSD, respectively; pinned source
fetches retain upstream license files. `xz-input.h` retains the existing pinned
project fixture verbatim.
