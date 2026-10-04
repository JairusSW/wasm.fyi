// Representative feature corpus identities; results come from sealed reports.
import { viewData } from "../view-data";
import type { CompatSection, FeatureRow, Proposal, ProposalId, SupportCode } from './types';

export const BROWSERS = ['Chrome', 'Firefox', 'Safari'];
export const FEATS: FeatureRow[] = [
  { g: 'Core instructions', id: 'core-num', name: 'Numeric instructions', phase: 'Core corpus', b: ['?', '?', '?'], r: '???????' },
  { g: 'Core instructions', id: 'core-mem', name: 'Memory instructions', phase: 'Core corpus', b: ['?', '?', '?'], r: '???????' },
  { g: 'Core instructions', id: 'core-ctl', name: 'Control flow', phase: 'Core corpus', b: ['?', '?', '?'], r: '???????' },
  { g: 'Core instructions', id: 'core-tab', name: 'Tables', phase: 'Core corpus', b: ['?', '?', '?'], r: '???????' },
  { g: 'Core instructions', id: 'core-val', name: 'Structural validation', phase: 'Compile / instantiate probes', b: ['?', '?', '?'], r: '???????' },
  { g: 'System interfaces', id: 'cm-abi', name: 'Canonical ABI', phase: 'Component corpus', b: ['?', '?', '?'], r: '???????' },
  { g: 'System interfaces', id: 'cm-res', name: 'Resources', phase: 'Component corpus', b: ['?', '?', '?'], r: '???????' },
  { g: 'System interfaces', id: 'cm-async', name: 'Async components', phase: 'Compile-only probes', b: ['?', '?', '?'], r: '???????' },
  { g: 'Wasm 2.0', id: 'bulk-memory', name: 'Bulk memory', phase: 'Phase 5 · Wasm 2.0', b: ['75', '79', '15'], r: 'yyy?yyp' },
  { g: 'Wasm 2.0', id: 'reference-types', name: 'Reference types', phase: 'Phase 5 · Wasm 2.0', b: ['96', '79', '15'], r: 'yyy?yyn' },
  { g: 'Wasm 2.0', id: 'multi-value', name: 'Multi-value', phase: 'Phase 5 · Wasm 2.0', b: ['85', '78', '13.1'], r: 'yyy?yyy' },
  { g: 'Wasm 2.0', id: 'simd', name: 'Fixed-width SIMD', phase: 'Phase 5 · Wasm 2.0', b: ['91', '89', '16.4'], r: 'yyy?yyn', page: 'simd' },
  { g: 'Wasm 3.0', id: 'gc', name: 'Garbage collection', phase: 'Phase 5 · Wasm 3.0', b: ['119', '120', '18.2'], r: 'ynn?npn', page: 'gc' },
  { g: 'Wasm 3.0', id: 'memory64', name: 'Memory64', phase: 'Phase 5 · Wasm 3.0', b: ['133', '134', 'n'], r: 'ypn?ypn', page: 'memory64' },
  { g: 'Wasm 3.0', id: 'exceptions', name: 'Exception handling (exnref)', phase: 'Phase 5 · Wasm 3.0', b: ['137', '131', '18.4'], r: 'ypn?npn' },
  { g: 'Wasm 3.0', id: 'tail-call', name: 'Tail calls', phase: 'Phase 5 · Wasm 3.0', b: ['112', '121', '18.2'], r: 'yny?yyn' },
  { g: 'Wasm 3.0', id: 'relaxed-simd', name: 'Relaxed SIMD', phase: 'Phase 5 · Wasm 3.0', b: ['114', 'f', 'n'], r: 'yfn?nnn' },
  { g: 'Wasm 3.0', id: 'multi-memory', name: 'Multiple memories', phase: 'Phase 5 · Wasm 3.0', b: ['120', '125', 'n'], r: 'yyn?ypn' },
  { g: 'Wasm 3.0', id: 'extended-const', name: 'Extended constant expressions', phase: 'Phase 5 · Wasm 3.0', b: ['114', '112', '17.4'], r: 'yyy?yyn' },
  { g: 'Wasm 3.0', id: 'js-string-builtins', name: 'JS string builtins', phase: 'Phase 5 · Wasm 3.0', b: ['130', '134', 'n'], r: '-------' },
  { g: 'In progress', id: 'threads', name: 'Threads & atomics', phase: 'Phase 4', b: ['74', '79', '14.1'], r: 'fyf?nyn', page: 'threads' },
  { g: 'System interfaces', id: 'wasi-p1', name: 'WASI 0.1 (preview1)', phase: 'WASI 0.1', b: ['n', 'n', 'n'], r: 'yyy?yyp' },
  { g: 'System interfaces', id: 'wasi-p2', name: 'WASI 0.2', phase: 'WASI 0.2', b: ['n', 'n', 'n'], r: 'ynn?nnn' },
  { g: 'System interfaces', id: 'component-model', name: 'Component Model', phase: 'Phase 1', b: ['n', 'n', 'n'], r: 'ynn?nnn' },
];
export const SUPC: Record<SupportCode, [string, string]> = { y: ['●', 'yes'], f: ['⚑', 'flag'], p: ['◐', 'partial'], n: ['—', 'no'], '?': ['?', 'unknown'], '-': ['·', 'n/a'] };
export const PROPS: Record<ProposalId, Proposal> = {
  simd: { title: 'SIMD', long: 'Fixed-width 128-bit SIMD', q: 'How much faster does SIMD actually make Wasm?', repo: 'github.com/WebAssembly/simd', ver: 'WebAssembly 2.0', hist: [['2017', 'Proposal repository created'], ['2020', 'Phase 3 — implementation'], ['2021', 'Phase 4 — standardize'], ['2022', 'Merged into WebAssembly 2.0 draft']], tools: [['Emscripten', 'y', '-msimd128'], ['clang / wasi-sdk', 'y', '-msimd128'], ['rustc', 'y', '-C target-feature=+simd128'], ['TinyGo', 'p', 'limited auto-vectorization'], ['Go (wasip1)', 'n', ''], ['Binaryen', 'y', '--enable-simd'], ['AssemblyScript', 'y', '--enable simd']] },
  gc: { title: 'WasmGC', long: 'Garbage-collected structs and arrays', q: 'What is the allocation throughput and memory behavior of WasmGC implementations?', repo: 'github.com/WebAssembly/gc', ver: 'WebAssembly 3.0', hist: [['2017', 'Proposal started'], ['2022', 'Phase 3 — implementation'], ['2023', 'Phase 4 — shipped in Chrome and Firefox'], ['2025', 'Part of WebAssembly 3.0']], tools: [['Kotlin/Wasm', 'y', 'wasmJs / wasmWasi targets'], ['Dart (dart2wasm)', 'y', 'dart compile wasm'], ['J2Wasm (J2CL)', 'y', ''], ['wasm_of_ocaml', 'y', ''], ['Binaryen', 'y', '--enable-gc'], ['Emscripten', 'n', 'linear memory only'], ['rustc', 'n', '']] },
  memory64: { title: 'Memory64', long: '64-bit linear memory addressing', q: 'What does 64-bit addressing cost compared to a matched 32-bit build?', repo: 'github.com/WebAssembly/memory64', ver: 'WebAssembly 3.0', hist: [['2018', 'Proposal started'], ['2021', 'Phase 3 — implementation'], ['2025', 'Phase 4 and WebAssembly 3.0']], tools: [['Emscripten', 'y', '-sMEMORY64'], ['clang / wasi-sdk', 'y', '--target=wasm64'], ['rustc', 'p', 'wasm64-unknown-unknown (tier 3)'], ['Binaryen', 'y', '--enable-memory64'], ['Go', 'n', '']] },
  threads: { title: 'Threads', long: 'Shared memory and atomics', q: 'How does throughput scale with worker count, and what does each worker cost?', repo: 'github.com/WebAssembly/threads', ver: 'Phase 4 (not yet in a release)', hist: [['2017', 'Proposal started'], ['2019', 'Shipped in Chrome 74'], ['2020', 'Shipped in Firefox 79'], ['2023', 'Phase 4']], tools: [['Emscripten', 'y', '-pthread'], ['clang / wasi-sdk', 'y', 'wasm32-wasip1-threads'], ['rustc', 'p', 'nightly, build-std'], ['Binaryen', 'y', '--enable-threads'], ['Go', 'n', '']] },
};
const familyIds=[...new Set(viewData.catalogue.filter(w=>w.id.startsWith('features/')).map(w=>w.id.split('/')[1]))];
export const COMPAT: CompatSection[] = [
  {sec:'Core instruction corpus',unit:'contracts',suite:'Original MIT corpus · independent exact oracles',fams:[]},
  {sec:'Feature and interface corpus',unit:'contracts',suite:'Original MIT corpus · independent exact oracles',fams:[]}
];
for(const id of familyIds) {
  const workloads=viewData.catalogue.filter(w=>w.id.startsWith('features/'+id+'/') && !w.baseline);
  const metadata=FEATS.find(f=>f.id===id);
  COMPAT[id.startsWith('core-')?0:1].fams.push({id,name:metadata?.name || id,total:workloads.length,page:metadata?.page,
    kids:workloads.map(w=>[w.id,1]),r:[]});
}
// Browser release histories and uncollected engine defaults are not inferred
// from a Node embedding or a configuration-specific corpus run.
for(const f of FEATS){f.b=['?','?','?'];f.r='?????????';}
export const FLAGS: Record<string,string> = {};
export const FT: Record<string,[string,string,string,string,string,string][]> = {};
