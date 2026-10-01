// Feature status, proposal metadata and spec-test results. Synthetic preview data.
import type { CompatSection, FeatureRow, Proposal, ProposalId, SupportCode } from './types';

export const BROWSERS = ['Chrome', 'Firefox', 'Safari'];
export const FEATS: FeatureRow[] = [
  { g: 'Wasm 2.0', id: 'bulk-memory', name: 'Bulk memory', phase: 'Phase 5 · Wasm 2.0', b: ['75', '79', '15'], r: 'yyy?yyypy' },
  { g: 'Wasm 2.0', id: 'reference-types', name: 'Reference types', phase: 'Phase 5 · Wasm 2.0', b: ['96', '79', '15'], r: 'yyy?yyyny' },
  { g: 'Wasm 2.0', id: 'multi-value', name: 'Multi-value', phase: 'Phase 5 · Wasm 2.0', b: ['85', '78', '13.1'], r: 'yyy?yyyyy' },
  { g: 'Wasm 2.0', id: 'simd', name: 'Fixed-width SIMD', phase: 'Phase 5 · Wasm 2.0', b: ['91', '89', '16.4'], r: 'yyy?yyyny', page: 'simd' },
  { g: 'Wasm 3.0', id: 'gc', name: 'Garbage collection', phase: 'Phase 5 · Wasm 3.0', b: ['119', '120', '18.2'], r: 'ynn?nfpnn', page: 'gc' },
  { g: 'Wasm 3.0', id: 'memory64', name: 'Memory64', phase: 'Phase 5 · Wasm 3.0', b: ['133', '134', 'n'], r: 'ypn?ynpnn', page: 'memory64' },
  { g: 'Wasm 3.0', id: 'exceptions', name: 'Exception handling (exnref)', phase: 'Phase 5 · Wasm 3.0', b: ['137', '131', '18.4'], r: 'ypn?nppnp' },
  { g: 'Wasm 3.0', id: 'tail-call', name: 'Tail calls', phase: 'Phase 5 · Wasm 3.0', b: ['112', '121', '18.2'], r: 'yny?yyynp' },
  { g: 'Wasm 3.0', id: 'relaxed-simd', name: 'Relaxed SIMD', phase: 'Phase 5 · Wasm 3.0', b: ['114', 'f', 'n'], r: 'yfn?nnnnn' },
  { g: 'Wasm 3.0', id: 'multi-memory', name: 'Multiple memories', phase: 'Phase 5 · Wasm 3.0', b: ['120', '125', 'n'], r: 'yyn?yypnn' },
  { g: 'Wasm 3.0', id: 'extended-const', name: 'Extended constant expressions', phase: 'Phase 5 · Wasm 3.0', b: ['114', '112', '17.4'], r: 'yyy?yyyny' },
  { g: 'Wasm 3.0', id: 'js-string-builtins', name: 'JS string builtins', phase: 'Phase 5 · Wasm 3.0', b: ['130', '134', 'n'], r: '---------' },
  { g: 'In progress', id: 'threads', name: 'Threads & atomics', phase: 'Phase 4', b: ['74', '79', '14.1'], r: 'fyf?nyynf', page: 'threads' },
  { g: 'In progress', id: 'stack-switching', name: 'Stack switching', phase: 'Phase 3', b: ['f', 'n', 'n'], r: 'nnn?nnnnn' },
  { g: 'System interfaces', id: 'wasi-p1', name: 'WASI 0.1 (preview1)', phase: 'WASI 0.1', b: ['n', 'n', 'n'], r: 'yyy?yyypy' },
  { g: 'System interfaces', id: 'wasi-p2', name: 'WASI 0.2', phase: 'WASI 0.2', b: ['n', 'n', 'n'], r: 'ynn?npnnn' },
  { g: 'System interfaces', id: 'component-model', name: 'Component Model', phase: 'Phase 1', b: ['n', 'n', 'n'], r: 'ynn?npnnn' },
];
export const SUPC: Record<SupportCode, [string, string]> = { y: ['●', 'yes'], f: ['⚑', 'flag'], p: ['◐', 'partial'], n: ['—', 'no'], '?': ['?', 'unknown'], '-': ['·', 'n/a'] };
export const PROPS: Record<ProposalId, Proposal> = {
  simd: { title: 'SIMD', long: 'Fixed-width 128-bit SIMD', q: 'How much faster does SIMD actually make Wasm?', repo: 'github.com/WebAssembly/simd', ver: 'WebAssembly 2.0', hist: [['2017', 'Proposal repository created'], ['2020', 'Phase 3 — implementation'], ['2021', 'Phase 4 — standardize'], ['2022', 'Merged into WebAssembly 2.0 draft']], tools: [['Emscripten', 'y', '-msimd128'], ['clang / wasi-sdk', 'y', '-msimd128'], ['rustc', 'y', '-C target-feature=+simd128'], ['TinyGo', 'p', 'limited auto-vectorization'], ['Go (wasip1)', 'n', ''], ['Binaryen', 'y', '--enable-simd'], ['AssemblyScript', 'y', '--enable simd']] },
  gc: { title: 'WasmGC', long: 'Garbage-collected structs and arrays', q: 'What is the allocation throughput and memory behavior of WasmGC implementations?', repo: 'github.com/WebAssembly/gc', ver: 'WebAssembly 3.0', hist: [['2017', 'Proposal started'], ['2022', 'Phase 3 — implementation'], ['2023', 'Phase 4 — shipped in Chrome and Firefox'], ['2025', 'Part of WebAssembly 3.0']], tools: [['Kotlin/Wasm', 'y', 'wasmJs / wasmWasi targets'], ['Dart (dart2wasm)', 'y', 'dart compile wasm'], ['J2Wasm (J2CL)', 'y', ''], ['wasm_of_ocaml', 'y', ''], ['Binaryen', 'y', '--enable-gc'], ['Emscripten', 'n', 'linear memory only'], ['rustc', 'n', '']] },
  memory64: { title: 'Memory64', long: '64-bit linear memory addressing', q: 'What does 64-bit addressing cost compared to a matched 32-bit build?', repo: 'github.com/WebAssembly/memory64', ver: 'WebAssembly 3.0', hist: [['2018', 'Proposal started'], ['2021', 'Phase 3 — implementation'], ['2025', 'Phase 4 and WebAssembly 3.0']], tools: [['Emscripten', 'y', '-sMEMORY64'], ['clang / wasi-sdk', 'y', '--target=wasm64'], ['rustc', 'p', 'wasm64-unknown-unknown (tier 3)'], ['Binaryen', 'y', '--enable-memory64'], ['Go', 'n', '']] },
  threads: { title: 'Threads', long: 'Shared memory and atomics', q: 'How does throughput scale with worker count, and what does each worker cost?', repo: 'github.com/WebAssembly/threads', ver: 'Phase 4 (not yet in a release)', hist: [['2017', 'Proposal started'], ['2019', 'Shipped in Chrome 74'], ['2020', 'Shipped in Firefox 79'], ['2023', 'Phase 4']], tools: [['Emscripten', 'y', '-pthread'], ['clang / wasi-sdk', 'y', 'wasm32-wasip1-threads'], ['rustc', 'p', 'nightly, build-std'], ['Binaryen', 'y', '--enable-threads'], ['Go', 'n', '']] },
};
export const COMPAT: CompatSection[] = [
  { sec: 'Core specification', unit: 'assertions', suite: 'WebAssembly/testsuite @ 3f2a9c1 (2026-09-12)', fams: [
    { id: 'core-num', name: 'Numeric instructions', total: 18420, kids: [['Integer (i32 / i64)', .5], ['Float (f32 / f64)', .44], ['Conversions', .06]], r: ['d', 'd', 'd', 'd:.9998', 'd:.9991', 'd', 'd:.9964'] },
    { id: 'core-mem', name: 'Memory & data', total: 3210, kids: [['Load / store', .58], ['Bulk memory', .29], ['memory.grow / size', .13]], r: ['d', 'd', 'd', 'd', 'd:.9975', 'd', 'd:.991:c2'] },
    { id: 'core-ctl', name: 'Control flow', total: 2644, kids: [['Blocks & branches', .62], ['Calls & call_indirect', .38]], r: ['d', 'd', 'd', 'd:.9992', 'd', 'd', 'd:.9981'] },
    { id: 'core-tab', name: 'Tables & reference types', total: 1720, kids: [['Table ops', .55], ['funcref / externref', .45]], r: ['d', 'd', 'd:.9988', 'd', 'd:.994', 'd', 'd:.982'] },
    { id: 'core-val', name: 'Validation & binary format', total: 4112, kids: [['Malformed binaries', .41], ['Invalid modules', .59]], r: ['d', 'd', 'd', 'd', 'd', 'd', 'd:.9971:s14'] }] },
  { sec: 'Proposals & extensions', unit: 'assertions', suite: 'WebAssembly/testsuite proposals/ @ 3f2a9c1', fams: [
    { id: 'simd', name: 'Fixed-width SIMD', total: 2847, page: 'simd', kids: [['Lane operations', .34], ['Arithmetic', .46], ['Loads / stores', .2]], r: ['d', 'd', 'd', 'd:.9993', 'u', 'd', 'd:.962'] },
    { id: 'relaxed-simd', name: 'Relaxed SIMD', total: 212, kids: [['madd / nmadd', .3], ['swizzle / laneselect', .4], ['trunc / dot', .3]], r: ['f', 'f', 'f:.98', 'u', 'u', 'd', 'u'] },
    { id: 'threads', page: 'threads', name: 'Threads & atomics', total: 624, kids: [['Atomic RMW', .6], ['wait / notify', .4]], r: ['d:.995', 'd:.995', 'd:.99:c3', 'f:.96', 'u', 'd', 'f:.88:c9'] },
    { id: 'exceptions', name: 'Exception handling (exnref)', total: 488, kids: [['throw / try_table', .7], ['throw_ref', .3]], r: ['d', 'd', 'f:.97', 'f:.94', 'u', 'd', '?'] },
    { id: 'tail-call', name: 'Tail calls', total: 176, kids: [['return_call', .5], ['return_call_indirect', .5]], r: ['d', 'd', 'd', 'u', 'd', 'd', 'd:.97'] },
    { id: 'memory64', page: 'memory64', name: 'Memory64', total: 1934, kids: [['i64 addressing', .7], ['Bounds', .3]], r: ['d', 'd:.998', 'f:.99', 'u', 'u', 'd', 'u'] },
    { id: 'gc', page: 'gc', name: 'Garbage collection (WasmGC)', total: 3102, kids: [['Structs & arrays', .45], ['Casts & subtyping', .35], ['i31', .2]], r: ['d:.998', 'd:.998', 'f:.91:c6', 'f:.87', 'u', 'd', 'u'] },
    { id: 'multi-memory', name: 'Multiple memories', total: 402, kids: [['Addressing', 1]], r: ['d', 'd', 'f', 'u', 'u', 'f', '?'] },
    { id: 'extended-const', name: 'Extended constant expressions', total: 64, kids: [['Global initializers', 1]], r: ['d', 'd', 'd', 'd', 'n', 'd', '?'] }] },
  { sec: 'Host interfaces (WASI)', unit: 'test cases', suite: 'WebAssembly/wasi-testsuite @ 9e0d44b (2026-09-03)', fams: [
    { id: 'wasi-p1', name: 'WASI preview1', total: 412, kids: [['fd_*', .45], ['path_*', .3], ['clocks / random / poll', .25]], r: ['d', 'd', 'd:.995', 'd:.99', 'd:.98', 'u', 'd:.94'] },
    { id: 'wasi-p2', name: 'WASI 0.2', total: 1180, kids: [['cli', .2], ['filesystem', .45], ['sockets', .2], ['http', .15]], r: ['d:.99', 'd:.99', 'f:.93', 'u', 'u', 'u', 'u'] }] },
  { sec: 'Component Model', unit: 'test files', suite: 'component-model tests @ 71c5e02 (2026-08-28)', fams: [
    { id: 'cm-abi', name: 'Canonical ABI', total: 540, kids: [['lift / lower', .7], ['strings', .3]], r: ['d:.998', 'd:.998', 'f:.94', 'u', 'u', 'u', 'u'] },
    { id: 'cm-res', name: 'Resources', total: 230, kids: [['own / borrow', 1]], r: ['d', 'd', 'f:.9', 'u', 'u', 'u', 'u'] },
    { id: 'cm-async', name: 'Async (0.3 preview)', total: 188, kids: [['streams / futures', 1]], r: ['f:.72:s30', 'f:.72:s30', '?', 'u', 'u', 'u', 'n'] }] },
];
export const FLAGS: Record<string, string> = { 'relaxed-simd': '--wasm-relaxed-simd', threads: '--wasm-threads', exceptions: '--wasm-exnref', memory64: '--wasm-memory64', gc: '--wasm-gc', 'multi-memory': '--wasm-multi-memory', 'wasi-p2': '--wasi-p2', 'cm-abi': '--component-model', 'cm-res': '--component-model', 'cm-async': '--component-model-async' };
export const FT: Record<string, [string, string, string, string, string, string][]> = {
  'core-num': [['f32.wast', 'assert_return', '(f32.nearest (f32.const -0x1.fffffep+22))', 'f32:-0x1p+23', 'f32:-0x1.fffffcp+22', 'round-to-nearest-even differs in interpreter fast path']],
  'core-mem': [['memory_grow.wast', 'assert_return', '(memory.grow (i32.const 0x10000))', 'i32:-1', 'i32:0', 'grow past declared max accepted when reservation succeeds']],
  simd: [['simd_lane.wast', 'assert_return', '(i8x16.extract_lane_s 15 (v128.const i8x16 … -1))', 'i32:-1', 'i32:255', 'sign extension missing in lane extract'], ['simd_f32x4.wast', 'assert_return', '(f32x4.min (v128.const f32x4 -0 …) (v128.const f32x4 0 …))', 'f32x4:-0 …', 'f32x4:0 …', 'signed-zero ordering in min lowering']],
  threads: [['atomic.wast', 'assert_return', '(i64.atomic.rmw.cmpxchg (i32.const 8) …)', 'i64:0x8000000000000000', 'i64:0', 'torn 64-bit compare-exchange']],
  gc: [['ref_cast.wast', 'assert_trap', '(ref.cast (ref $t) (local.get 0))', 'trap: cast failure', 'returned ref', 'subtype check skips final types']],
  exceptions: [['throw_ref.wast', 'assert_exception', '(throw_ref (local.get $exn))', 'exception $e', 'trap: uncaught', 'exnref not preserved across try_table']],
};
