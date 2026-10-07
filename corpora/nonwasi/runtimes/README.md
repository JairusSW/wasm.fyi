# Import-free language runtimes

These are upstream interpreters, not translations of the benchmark algorithms to C.
Every call allocates an engine, parses the complete original source program from
memory, executes it, captures its complete printed output, then frees the engine.

| Original workload | Replacement | Engine source |
| --- | --- | --- |
| lua-cli-buckets | lua-memory-buckets | Lua 5.4.6, archive SHA-256 `7d5ea1b9cb6aa0b59ca3dde1c6adcb57ef83a1ba8e5432c0ecd06bf439b3ad88` |
| quickjs-script | quickjs-memory-events | QuickJS `535a7c250ff4a577ec36c3e103daab6dadeea650` |
| ruby-buckets | mruby-memory-buckets | mruby 3.4.0 `a309524d0bc90eef077a24634db2495a6f68e318` |

The source programs are unchanged from the prior main corpus. Lua retains the
million-event bitwise/table/ranking workload; JavaScript retains 50,000 generated
strings, regexp parsing, numeric conversion, aggregation, array callbacks and
sorting. Ruby retains Hash defaults, Range iteration, Enumerable mapping, integer
arithmetic and string interpolation. mruby is deliberately identified as a new
engine and workload identity rather than claiming MRI Ruby equivalence.

## Host/build dependencies

WASI SDK 34 supplies Clang and statically linked C memory/math/string routines;
the resulting modules have **no imports**, including no WASI imports. mruby's
build also requires a native C compiler, GNU make, Ruby and the Rake Ruby library.
`RUBY` can select the host Ruby executable. Its `ruby` command must be on PATH
for upstream mruby's bundled Lrama parser generator. No external gems, gperf or
bison downloads are needed: mruby includes Lrama and its generated keyword table.

`../../../scripts/nonwasi-runtimes.mjs` records the pin-checked source edits and
build flags. It rejects any resulting imports and executes three calls against
an independently established oracle before returning a contract.

## Explicit embedding boundaries

- Lua registers the table and string libraries and a memory-only print callback.
  There is no io, os, package loader, or debug CLI. Its hash and sort-pivot seeds
  are explicit deterministic constants via upstream-supported configuration.
- QuickJS creates a raw context and explicitly registers base objects, eval,
  regular expressions and JSON. Date, Atomics, host modules and the QuickJS libc
  shell are not linked. Math's internal random seed is deterministic. Optional
  allocator-size introspection uses upstream's documented zero-return fallback.
- mruby compiles with `MRB_NO_STDIO` and `MRB_INT64`; only core mrblib and the
  in-memory compiler gem are built. `puts` is a memory-only output callback.
- Lua and mruby exception paths trap fatally rather than recovering through
  setjmp/longjmp. The fixed successful programs do not exercise recovery. These
  are workload embeddings, not unrestricted interactive interpreter APIs.
- `fatal.c` implements fatal abort and stack-check failure as Wasm traps. A static
  benchmark stack canary avoids entropy initialization; it is not a security
  boundary for untrusted programs. No filesystem, clock, process or random
  syscall is defined or stubbed. Full long-double formatting support avoids
  pulling in libc's unsupported-format diagnostic path and stderr.
- `__wasm_call_ctors` is exported and initialized once per instance. This avoids
  automatic per-call libc destructor wrappers. The run export creates and
  destroys its own engine and is stateless across successful calls.

## Independent exact-output references

The checked-in `.stdout` files were generated independently using native Lua
5.4.6, Node.js and native Ruby 3.3.8. All three SHA-256 values exactly match the
original corpus's previously recorded stdout hashes:

- Lua: `0596a0eadbe52c645aa00bb7fca2ed57f1620d4041ce78dc40080b2b934468fb`
- JavaScript: `485ded1ee5ff38dee328f324894460d61da6914badb6cf5359a36a3e14ca865b`
- Ruby: `a9cfd18aeeb61f448d9314c2687d0bf22b1a287a4a3b165a5aa676ff4b0de869`

The contract is unsigned 32-bit FNV-1a of every output byte, including delimiters
and final newline: Lua `3845025982`, QuickJS `1062390962`, mruby `4009348093`.
Fifty repeated same-instance calls returned identical results, with stable
post-warmup linear memory: Lua 4,325,376 bytes, QuickJS and mruby 4,456,448 bytes.

Upstream license notices accompany the wrappers as `LICENSE.lua`,
`LICENSE.quickjs`, and `LICENSE.mruby` (all MIT).
