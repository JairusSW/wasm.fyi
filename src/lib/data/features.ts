// Representative feature corpus identities; results come from sealed reports.
import {liveArray} from "../api/live-array";
import { viewData } from "../view-data";
import type { CompatSection, FeatureRow, Proposal, ProposalId, SupportCode } from './types';
import proposalSnapshot from './proposals.json';

export const BROWSERS = ['Chrome', 'Firefox', 'Safari'];
// Measured corpus families keyed by their corpus id. Phases come from the proposal
// snapshot below; these rows only add naming and dedicated pages.
const CORE: FeatureRow[] = [
  { g: '', id: 'core-num', name: 'MVP · Numeric instructions', phase: 'Core corpus', b: [], r: '', url: 'https://webassembly.github.io/spec/core/syntax/instructions.html#numeric-instructions' },
  { g: '', id: 'core-mem', name: 'MVP · Memory instructions', phase: 'Core corpus', b: [], r: '', url: 'https://webassembly.github.io/spec/core/syntax/instructions.html#memory-instructions' },
  { g: '', id: 'core-ctl', name: 'MVP · Control flow', phase: 'Core corpus', b: [], r: '', url: 'https://webassembly.github.io/spec/core/syntax/instructions.html#control-instructions' },
  { g: '', id: 'core-tab', name: 'MVP · Tables', phase: 'Core corpus', b: [], r: '', url: 'https://webassembly.github.io/spec/core/syntax/instructions.html#table-instructions' },
  { g: '', id: 'core-val', name: 'MVP · Structural validation', phase: 'Compile / instantiate probes', b: [], r: '', url: 'https://webassembly.github.io/spec/core/valid/index.html' },
];
const SYSTEM: FeatureRow[] = [
  { g: 'System interfaces', id: 'wasi-p1', name: 'WASI 0.1 (preview1)', phase: 'WASI 0.1', b: [], r: '', url: 'https://github.com/WebAssembly/WASI/tree/main/legacy/preview1' },
  { g: 'System interfaces', id: 'wasi-p2', name: 'WASI 0.2', phase: 'WASI 0.2', b: [], r: '', url: 'https://github.com/WebAssembly/WASI/tree/main/wasip2' },
  { g: 'System interfaces', id: 'cm-abi', name: 'Component Model · Canonical ABI', phase: 'Component corpus', b: [], r: '', url: 'https://github.com/WebAssembly/component-model/blob/main/design/mvp/CanonicalABI.md' },
  { g: 'System interfaces', id: 'cm-res', name: 'Component Model · Resources', phase: 'Component corpus', b: [], r: '', url: 'https://github.com/WebAssembly/component-model/blob/main/design/mvp/Explainer.md#handle-types' },
  { g: 'System interfaces', id: 'cm-async', name: 'Component Model · Async', phase: 'Compile-only probes', b: [], r: '', url: 'https://github.com/WebAssembly/component-model/blob/main/design/mvp/Async.md' },
];
/** webassembly.org feature key → existing corpus id and dedicated page. Names stay official. */
const KNOWN: Record<string, { id: string; page?: ProposalId }> = {
  bulkMemory: { id: 'bulk-memory' },
  referenceTypes: { id: 'reference-types' },
  multiValue: { id: 'multi-value' },
  simd: { id: 'simd', page: 'simd' },
  gc: { id: 'gc', page: 'gc' },
  memory64: { id: 'memory64', page: 'memory64' },
  exceptionsFinal: { id: 'exceptions' },
  tailCall: { id: 'tail-call' },
  relaxedSimd: { id: 'relaxed-simd' },
  multiMemory: { id: 'multi-memory' },
  extendedConst: { id: 'extended-const' },
  jsStringBuiltins: { id: 'js-string-builtins' },
  threads: { id: 'threads', page: 'threads' },
  componentModel: { id: 'component-model' },
};
/** Group order follows webassembly.org/features: phase 5 → 1, then inactive. */
export const PHASE_GROUPS = [
  [5, 'Phase 5 · Standardized'],
  [4, 'Phase 4 · Standardize the feature'],
  [3, 'Phase 3 · Implementation'],
  [2, 'Phase 2 · Proposed spec text'],
  [1, 'Phase 1 · Feature proposal'],
  ['inactive', 'Inactive'],
] as const;
const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
export const PROPOSALS_RETRIEVED = proposalSnapshot.retrieved;
/** The features listed on webassembly.org/features, in its order. */
export const FEATS: FeatureRow[] = PHASE_GROUPS.flatMap(([phase, g]) =>
  proposalSnapshot.proposals
    .filter((p) => p.phase === phase)
    .map((p): FeatureRow => {
      const known = KNOWN[p.key];
      const label = phase === 'inactive' ? 'Inactive' : `Phase ${phase}` + (p.spec ? ` · Wasm ${p.spec}` : '');
      return { g, id: known?.id ?? kebab(p.key), name: p.name, phase: label, b: [], r: '', page: known?.page, url: p.url };
    }),
);
/** Measured corpus families outside the proposal list (core MVP, WASI, Component Model parts). Not listed on the features page. */
export const CORPUS_FEATS: FeatureRow[] = [...CORE.map((f) => ({ ...f, g: 'Core' })), ...SYSTEM];
export const SUPC: Record<SupportCode, [string, string]> = { y: ['●', 'yes'], f: ['⚑', 'flag'], p: ['◐', 'partial'], n: ['—', 'no'], '?': ['?', 'unknown'], '-': ['·', 'n/a'] };
export const PROPS: Record<ProposalId, Proposal> = {
  simd: { title: 'SIMD', long: 'Fixed-width 128-bit SIMD', q: 'How much faster does SIMD actually make Wasm?', repo: 'github.com/WebAssembly/simd', ver: 'WebAssembly 2.0', hist: [['2017', 'Proposal repository created'], ['2020', 'Phase 3 — implementation'], ['2021', 'Phase 4 — standardize'], ['2022', 'Merged into WebAssembly 2.0 draft']], tools: [['Emscripten', 'y', '-msimd128'], ['clang / wasi-sdk', 'y', '-msimd128'], ['rustc', 'y', '-C target-feature=+simd128'], ['TinyGo', 'p', 'limited auto-vectorization'], ['Go (wasip1)', 'n', ''], ['Binaryen', 'y', '--enable-simd'], ['AssemblyScript', 'y', '--enable simd']] },
  gc: { title: 'WasmGC', long: 'Garbage-collected structs and arrays', q: 'What is the allocation throughput and memory behavior of WasmGC implementations?', repo: 'github.com/WebAssembly/gc', ver: 'WebAssembly 3.0', hist: [['2017', 'Proposal started'], ['2022', 'Phase 3 — implementation'], ['2023', 'Phase 4 — shipped in Chrome and Firefox'], ['2025', 'Part of WebAssembly 3.0']], tools: [['Kotlin/Wasm', 'y', 'wasmJs / wasmWasi targets'], ['Dart (dart2wasm)', 'y', 'dart compile wasm'], ['J2Wasm (J2CL)', 'y', ''], ['wasm_of_ocaml', 'y', ''], ['Binaryen', 'y', '--enable-gc'], ['Emscripten', 'n', 'linear memory only'], ['rustc', 'n', '']] },
  memory64: { title: 'Memory64', long: '64-bit linear memory addressing', q: 'What does 64-bit addressing cost compared to a matched 32-bit build?', repo: 'github.com/WebAssembly/memory64', ver: 'WebAssembly 3.0', hist: [['2018', 'Proposal started'], ['2021', 'Phase 3 — implementation'], ['2025', 'Phase 4 and WebAssembly 3.0']], tools: [['Emscripten', 'y', '-sMEMORY64'], ['clang / wasi-sdk', 'y', '--target=wasm64'], ['rustc', 'p', 'wasm64-unknown-unknown (tier 3)'], ['Binaryen', 'y', '--enable-memory64'], ['Go', 'n', '']] },
  threads: { title: 'Threads', long: 'Shared memory and atomics', q: 'How does throughput scale with worker count, and what does each worker cost?', repo: 'github.com/WebAssembly/threads', ver: 'Phase 4 (not yet in a release)', hist: [['2017', 'Proposal started'], ['2019', 'Shipped in Chrome 74'], ['2020', 'Shipped in Firefox 79'], ['2023', 'Phase 4']], tools: [['Emscripten', 'y', '-pthread'], ['clang / wasi-sdk', 'y', 'wasm32-wasip1-threads'], ['rustc', 'p', 'nightly, build-std'], ['Binaryen', 'y', '--enable-threads'], ['Go', 'n', '']] },
};
export const COMPAT:CompatSection[]=liveArray(()=>{
 const sections:CompatSection[]=[
  {sec:'Core instruction corpus',unit:'contracts',suite:'Original MIT corpus · independent exact oracles',fams:[]},
  {sec:'Feature and interface corpus',unit:'contracts',suite:'Original MIT corpus · independent exact oracles',fams:[]}
 ];
 const families=[...new Set(viewData.catalogue.filter(w=>w.id.startsWith('features/')).map(w=>w.id.split('/')[1]))];
 for(const id of families){
  const workloads=viewData.catalogue.filter(w=>w.id.startsWith('features/'+id+'/')&&!w.baseline);
  const metadata=[...FEATS,...CORPUS_FEATS].find(f=>f.id===id);
  sections[id.startsWith('core-')?0:1].fams.push({id,name:metadata?.name||id,total:workloads.length,page:metadata?.page,kids:workloads.map(w=>[w.id,1]),r:[]});
 }
 return sections;
});
// Browser release histories and uncollected engine defaults are not inferred
// from a Node embedding or a configuration-specific corpus run.
for(const f of [...FEATS, ...CORPUS_FEATS]){f.b=['?','?','?'];f.r='?????????';}
export const FLAGS: Record<string,string> = {};
export const FT: Record<string,[string,string,string,string,string,string][]> = {};
