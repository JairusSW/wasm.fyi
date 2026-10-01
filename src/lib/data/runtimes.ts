// Measured configurations and hosts use pinned report identities. The standalone
// registry remains descriptive; it is not a benchmark or conformance result.
import { viewData } from '../view-data';
import type { Cfg, CfgId, Machine, MachineId, Runtime } from './types';

export const RTS: Runtime[] = [
  { id: 'wasmtime', name: 'Wasmtime', lang: 'Rust', exec: ['JIT', 'AOT'], tiers: 'Cranelift (optimizing) · Winch (baseline) · precompiled .cwasm', arch: ['x86-64', 'AArch64', 's390x', 'RISC-V 64'], wasi: '0.1 · 0.2', cm: 'y', repo: 'github.com/bytecodealliance/wasmtime', lic: 'Apache-2.0 WITH LLVM-exception', rel: '37.0.1', size: '9.4 MB', embed: ['Rust', 'C/C++', 'Python', '.NET', 'Go', 'Ruby'], cfg: ['A', 'B'], notes: ['Cranelift is shared with rustc_codegen_cranelift', 'Pooling allocator for high instance density', 'Fuel and epoch-based interruption', 'DRC and null collectors for WasmGC'] },
  { id: 'wasmer', name: 'Wasmer', lang: 'Rust', exec: ['JIT', 'AOT'], tiers: 'LLVM · Cranelift · Singlepass', arch: ['x86-64', 'AArch64', 'RISC-V 64'], wasi: '0.1 · WASIX', cm: 'n', repo: 'github.com/wasmerio/wasmer', lic: 'MIT', rel: '6.1.0', size: '11.8 MB', embed: ['Rust', 'C', 'Python', 'Go', 'JS', 'PHP'], cfg: ['C', 'D'], notes: ['Pluggable compiler backends', 'WASIX extends WASI with sockets, threads and fork', 'Headless engine for precompiled artifacts'] },
  { id: 'wazero', name: 'wazero', lang: 'Go', exec: ['Interpreter', 'AOT'], tiers: 'Interpreter · compiler (amd64, arm64)', arch: ['x86-64', 'AArch64', 'any (interpreter)'], wasi: '0.1', cm: 'n', repo: 'github.com/tetratelabs/wazero', lic: 'Apache-2.0', rel: '1.9.0', size: '5.1 MB', embed: ['Go'], cfg: ['E'], notes: ['Zero dependencies, no cgo', 'Compiler mode generates native code ahead of first call', 'Benchmarked here in interpreter mode'] },
  { id: 'wago', name: 'Wago', lang: 'Go', exec: ['Interpreter'], tiers: 'Interpreter', arch: ['any (Go targets)'], wasi: '0.1', cm: 'n', repo: '—', lic: '—', rel: '0.4.2', size: '—', embed: ['Go'], cfg: ['G'], notes: ['Metadata pending maintainer confirmation'] },
  { id: 'v8', name: 'V8', lang: 'C++', exec: ['JIT'], tiers: 'Liftoff (baseline) → TurboFan (optimizing) · lazy compile + dynamic tier-up', arch: ['x64', 'ARM64', 'IA-32', 'ARM', 'RISC-V', 's390x', 'PPC64', 'LoongArch'], wasi: '— (host provides)', cm: 'n', repo: 'chromium.googlesource.com/v8/v8', lic: 'BSD-3-Clause', rel: '14.1', size: '≈30 MB (incl. JS)', embed: ['C++', 'Node.js', 'Deno', 'Chromium'], cfg: ['F'], engine: 0, notes: ['WasmGC objects live on the JS heap', 'Compiled-module code caching', 'Lazy compilation by default'] },
  { id: 'spidermonkey', name: 'SpiderMonkey', lang: 'C++', exec: ['JIT'], tiers: 'Baseline → Ion (optimizing)', arch: ['x64', 'ARM64', 'x86', 'ARM', 'MIPS64', 'LoongArch', 'RISC-V 64'], wasi: '—', cm: 'n', repo: 'searchfox.org/mozilla-central', lic: 'MPL-2.0', rel: 'Firefox 143', size: '—', embed: ['C++', 'Firefox'], engine: 1, notes: ['Baseline compiler tuned for fast startup', 'Ion backend shared with JS'] },
  { id: 'jsc', name: 'JavaScriptCore', lang: 'C++', exec: ['Interpreter', 'JIT'], tiers: 'IPInt (in-place interpreter) → BBQ → OMG', arch: ['ARM64', 'x64'], wasi: '—', cm: 'n', repo: 'github.com/WebKit/WebKit', lic: 'LGPL-2.1 / BSD-2-Clause', rel: 'Safari 26', size: '—', embed: ['C', 'Swift / Obj-C', 'Safari', 'Bun'], engine: 2, notes: ['In-place interpreter skips a translation step', 'Three tiers with on-stack replacement'] },
  { id: 'wasmi', name: 'Wasmi', lang: 'Rust', exec: ['Interpreter'], tiers: 'Register-based interpreter · lazy translation', arch: ['any (Rust targets)', 'no_std'], wasi: '0.1', cm: 'n', repo: 'github.com/wasmi-labs/wasmi', lic: 'MIT OR Apache-2.0', rel: '0.51', size: '0.9 MB', embed: ['Rust', 'C'], notes: ['Designed for embedded and blockchain use', 'API mirrors Wasmtime', 'Lazy function translation for fast startup'] },
  { id: 'wasmedge', name: 'WasmEdge', lang: 'C++', exec: ['Interpreter', 'AOT'], tiers: 'Interpreter · LLVM AOT', arch: ['x86-64', 'AArch64', 'RISC-V 64'], wasi: '0.1 (+ 0.2 partial)', cm: 'p', repo: 'github.com/WasmEdge/WasmEdge', lic: 'Apache-2.0', rel: '0.15', size: '4.2 MB', embed: ['C', 'Rust', 'Go', 'Java', 'Python'], notes: ['Plugins for WASI-NN, sockets and crypto', 'CNCF sandbox project'] },
  { id: 'wamr', name: 'WAMR', lang: 'C', exec: ['Interpreter', 'JIT', 'AOT'], tiers: 'Classic + fast interpreter · Fast JIT · LLVM JIT · LLVM AOT', arch: ['x86-64', 'x86', 'AArch64', 'ARM', 'RISC-V', 'Xtensa', 'MIPS', 'ARC'], wasi: '0.1', cm: 'n', repo: 'github.com/bytecodealliance/wasm-micro-runtime', lic: 'Apache-2.0 WITH LLVM-exception', rel: '2.4', size: '≈85 KB (interp)', embed: ['C', 'Rust', 'Go', 'Python'], notes: ['Built for embedded and IoT targets', 'Footprint configurable per feature'] },
  { id: 'wasm3', name: 'wasm3', lang: 'C', exec: ['Interpreter'], tiers: 'Threaded-code interpreter', arch: ['any (C99)', 'microcontrollers'], wasi: '0.1 (partial)', cm: 'n', repo: 'github.com/wasm3/wasm3', lic: 'MIT', rel: '0.5.0', size: '≈65 KB', embed: ['C', 'Python', 'Rust', 'Go', 'Swift'], notes: ['Minimal-maintenance mode', 'Runs on microcontrollers'] },
  { id: 'chicory', name: 'Chicory', lang: 'Java', exec: ['Interpreter', 'AOT'], tiers: 'Interpreter · AOT to JVM bytecode', arch: ['any (JVM)'], wasi: '0.1', cm: 'n', repo: 'github.com/dylibso/chicory', lic: 'Apache-2.0', rel: '1.5', size: '≈1 MB (jar)', embed: ['Java', 'Kotlin', 'JVM'], notes: ['Pure JVM, no native dependencies', 'Build-time AOT compiles Wasm to Java bytecode'] },
];
export const RTB: Record<string, Runtime> = Object.fromEntries(RTS.map(r => [r.id, r]));
export const SA = ['wasmtime', 'wasmer', 'wazero', 'wago', 'wasmi', 'wasmedge', 'wamr', 'wasm3', 'chicory'];
export const CFG: Cfg[] = [
  { id: 'A', rt: 'wasmtime', ver: '37.0.1', be: 'cranelift', kind: 'optimizing JIT', col: 'var(--rt-wasmtime)', hollow: false },
  { id: 'B', rt: 'wasmtime', ver: '37.0.1', be: 'winch', kind: 'baseline JIT', col: 'var(--rt-wasmtime)', hollow: true },
  { id: 'C', rt: 'wasmer', ver: '6.1.0', be: 'llvm', kind: 'ahead-of-time', col: 'var(--rt-wasmer)', hollow: false },
  { id: 'D', rt: 'wasmer', ver: '6.1.0', be: 'singlepass', kind: 'single-pass JIT', col: 'var(--rt-wasmer)', hollow: true },
  { id: 'E', rt: 'wazero', ver: '1.9.0', be: 'interpreter', kind: 'interpreter', col: 'var(--rt-wazero)', hollow: false, interp: true },
  { id: 'F', rt: 'v8', ver: '14.1.146', be: 'tiered', kind: 'baseline → optimizing tiers', col: 'var(--rt-v8)', hollow: false },
  { id: 'G', rt: 'wago', ver: '0.4.2', be: 'interpreter', kind: 'interpreter', col: 'var(--rt-wago)', hollow: false, interp: true },
];

for(const c of CFG) {
  const measured=viewData.hosts.m1.configurations[c.id];
  if(measured){c.ver=measured.version.length>32?measured.version.slice(0,12):measured.version;c.be=measured.backend;}
  if(c.id==='E'||c.id==='G'){c.interp=false;c.kind='JIT compiler';}
  if(c.id==='C')c.kind='LLVM JIT';
}
for(const runtime of RTS) {
  const c=CFG.find(c=>c.rt===runtime.id);
  if(c){runtime.rel=c.ver;runtime.size='not measured';}
  if(runtime.id==='wazero')runtime.notes=runtime.notes.filter(note=>!note.includes('interpreter mode'));
  if(runtime.id==='wago'){runtime.exec=['JIT'];runtime.tiers='Railshot';runtime.notes=['Measured Railshot compiler configuration; exact source identity is recorded per report.'];}
}
export const WF: Record<CfgId,number> = {A:1,B:1,C:1,D:1,E:1,F:1,G:1};
export const MACH: Record<MachineId,Machine> = Object.fromEntries(Object.entries(viewData.hosts).map(([id,h])=>[id,{
  l:h.label,os:h.os,f:{},off:Object.fromEntries(CFG.filter(c=>!h.configurations[c.id]).map(c=>[c.id,'Configuration not collected on this host']))
}])) as Record<MachineId,Machine>;

export const CB = Object.fromEntries(CFG.map((c) => [c.id, c])) as Record<CfgId, Cfg>;
