// Measured configurations and hosts use pinned report identities. The standalone
// registry remains descriptive; it is not a benchmark or conformance result.
import { viewData } from '../view-data';
import type { Cfg, CfgId, Machine, MachineId, Runtime } from './types';

const runtimeRegistry: Runtime[] = [
  { id: 'wasmtime', name: 'Wasmtime', lang: 'Rust', exec: ['JIT', 'AOT'], tiers: 'Cranelift (optimizing) · Winch (baseline) · precompiled .cwasm', arch: ['x86-64', 'AArch64', 's390x', 'RISC-V 64'], wasi: '0.1 · 0.2', cm: 'y', repo: 'github.com/bytecodealliance/wasmtime', lic: 'Apache-2.0 WITH LLVM-exception', rel: '37.0.1', size: '9.4 MB', embed: ['Rust', 'C/C++', 'Python', '.NET', 'Go', 'Ruby'], cfg: ['A'], notes: ['Cranelift is shared with rustc_codegen_cranelift', 'Pooling allocator for high instance density', 'Fuel and epoch-based interruption', 'DRC and null collectors for WasmGC'] },
  { id: 'wasmer', name: 'Wasmer', lang: 'Rust', exec: ['JIT', 'AOT'], tiers: 'LLVM · Cranelift · Singlepass', arch: ['x86-64', 'AArch64', 'RISC-V 64'], wasi: '0.1 · WASIX', cm: 'n', repo: 'github.com/wasmerio/wasmer', lic: 'MIT', rel: '6.1.0', size: '11.8 MB', embed: ['Rust', 'C', 'Python', 'Go', 'JS', 'PHP'], cfg: ['D'], notes: ['Benchmarked here with the original Singlepass JIT backend.', 'WASIX extends WASI with sockets, threads and fork', 'Headless engine for precompiled artifacts'] },
  { id: 'wazero', name: 'wazero', lang: 'Go', exec: ['Interpreter', 'Compiler'], tiers: 'Wazevo compiler · interpreter', arch: ['x86-64', 'AArch64', 'any (interpreter)'], wasi: '0.1', cm: 'n', repo: 'github.com/tetratelabs/wazero', lic: 'Apache-2.0', rel: '1.9.0', size: '5.1 MB', embed: ['Go'], cfg: ['E'], notes: ['Zero dependencies, no cgo', 'The default runtime selects its compiler when supported by the host', 'Compiler and interpreter are measured as separate configurations'] },
  { id: 'wago', name: 'Wago', lang: 'Go', exec: ['Interpreter'], tiers: 'Interpreter', arch: ['any (Go targets)'], wasi: '0.1', cm: 'n', repo: '—', lic: '—', rel: '0.4.2', size: '—', embed: ['Go'], cfg: ['G'], notes: ['Metadata pending maintainer confirmation'] },
  { id: 'v8', name: 'V8', lang: 'C++', exec: ['JIT'], tiers: 'Turboshaft (optimizing-only benchmark)', arch: ['x64', 'ARM64', 'IA-32', 'ARM', 'RISC-V', 's390x', 'PPC64', 'LoongArch'], wasi: 'Preview 1 via Node.js host', cm: 'n', repo: 'chromium.googlesource.org/v8/v8', lic: 'BSD-3-Clause', rel: '14.1', size: '≈30 MB (incl. JS)', embed: ['C++', 'Node.js', 'Deno', 'Chromium'], cfg: ['F'], engine: 0, notes: ['Benchmark uses pinned Node.js V8 Turboshaft with Liftoff, tier-up and lazy compilation disabled', 'WasmGC objects live on the JS heap', 'Compiled-module code caching', 'Node.js supplies a WASI Preview 1 host; this is embedding support, not a V8 engine feature', 'WASI command results are recorded per host and workload in the benchmark evidence'] },
  { id: 'spidermonkey', name: 'SpiderMonkey', lang: 'C++', exec: ['JIT'], tiers: 'Baseline → Ion (optimizing)', arch: ['x64', 'ARM64', 'x86', 'ARM', 'MIPS64', 'LoongArch', 'RISC-V 64'], wasi: '—', cm: 'n', repo: 'searchfox.org/mozilla-central', lic: 'MPL-2.0', rel: 'Firefox 143', size: '—', embed: ['C++', 'Firefox'], engine: 1, notes: ['Baseline compiler tuned for fast startup', 'Ion backend shared with JS'] },
  { id: 'jsc', name: 'JavaScriptCore', lang: 'C++', exec: ['Interpreter', 'JIT'], tiers: 'IPInt (in-place interpreter) → BBQ → OMG', arch: ['ARM64', 'x64'], wasi: '—', cm: 'n', repo: 'github.com/WebKit/WebKit', lic: 'LGPL-2.1 / BSD-2-Clause', rel: 'Safari 26', size: '—', embed: ['C', 'Swift / Obj-C', 'Safari', 'Bun'], engine: 2, notes: ['In-place interpreter skips a translation step', 'Three tiers with on-stack replacement'] },
  { id: 'wasmi', name: 'Wasmi', lang: 'Rust', exec: ['Interpreter'], tiers: 'Register-based interpreter · lazy translation', arch: ['any (Rust targets)', 'no_std'], wasi: '0.1', cm: 'n', repo: 'github.com/wasmi-labs/wasmi', lic: 'MIT OR Apache-2.0', rel: '0.51', size: '0.9 MB', embed: ['Rust', 'C'], notes: ['Designed for embedded and blockchain use', 'API mirrors Wasmtime', 'Lazy function translation for fast startup'] },
  { id: 'wamr', name: 'WAMR', lang: 'C', exec: ['Interpreter', 'JIT', 'AOT'], tiers: 'Classic + fast interpreter · Fast JIT · LLVM JIT · LLVM AOT', arch: ['x86-64', 'x86', 'AArch64', 'ARM', 'RISC-V', 'Xtensa', 'MIPS', 'ARC'], wasi: '0.1', cm: 'n', repo: 'github.com/bytecodealliance/wasm-micro-runtime', lic: 'Apache-2.0 WITH LLVM-exception', rel: '2.4', size: '≈85 KB (interp)', embed: ['C', 'Rust', 'Go', 'Python'], notes: ['Built for embedded and IoT targets', 'Footprint configurable per feature'] },
  { id: 'wasm3', name: 'wasm3', lang: 'C', exec: ['Interpreter'], tiers: 'Threaded-code interpreter', arch: ['any (C99)', 'microcontrollers'], wasi: '0.1 (partial)', cm: 'n', repo: 'github.com/wasm3/wasm3', lic: 'MIT', rel: '0.5.0', size: '≈65 KB', embed: ['C', 'Python', 'Rust', 'Go', 'Swift'], notes: ['Minimal-maintenance mode', 'Runs on microcontrollers'] },
];
runtimeRegistry.push(
  {id:'wavm',name:'WAVM',lang:'C++',exec:['JIT'],tiers:'LLVM JIT',arch:['x86-64','AArch64'],wasi:'not tested',cm:'?',repo:'github.com/WAVM/WAVM',lic:'BSD-3-Clause',rel:'nightly-2026-04-05-4e82bb9',size:'not measured',embed:['C','C++'],notes:['Official WAVM prerelease built from source and benchmarked on Apple M4 Max and AMD Ryzen 7 7800X3D.','LLVM 21.1.8 backend.']},
  {id:'deno',name:'Deno',lang:'Rust',exec:['JIT'],tiers:'V8 production defaults',arch:['x86-64','AArch64'],wasi:'not tested',cm:'?',repo:'github.com/denoland/deno',lic:'MIT',rel:'not collected',size:'not measured',embed:['JavaScript','TypeScript'],notes:['Feature corpus uses a standalone Deno process; browser and Node results are separate configurations.']}
);
export const RTS = runtimeRegistry.filter(r=>['wasmtime','v8','wasmer','wazero','wavm','wago'].includes(r.id));
export const RTB: Record<string, Runtime> = Object.fromEntries(RTS.map(r => [r.id, r]));
export const SA = ['wasmtime', 'wasmer', 'wazero', 'wago', 'wavm'];
const applicationCFG: Cfg[] = [
  { id: 'A', rt: 'wasmtime', ver: '37.0.1', be: 'cranelift', kind: 'optimizing JIT', col: 'var(--rt-wasmtime)', hollow: false },
  { id: 'D', rt: 'wasmer', ver: '6.1.0', be: 'singlepass', kind: 'single-pass JIT', col: 'var(--rt-wasmer)', hollow: true },
  { id: 'E', rt: 'wazero', ver: '1.9.0', be: 'compiler', kind: 'Wazevo compiler', col: 'var(--rt-wazero)', hollow: false },
  { id: 'F', rt: 'v8', ver: 'not collected', be: 'turboshaft', kind: 'optimizing JIT', col: 'var(--rt-v8)', hollow: false },
  { id: 'G', rt: 'wago', ver: '0.4.2', be: 'railshot', kind: 'compiler', col: 'var(--rt-wago)', hollow: false, interp: false },
];

// The per-workload Benchmarks matrix includes each measured engine configuration.
// Aggregate leaderboards still use viewData.applicationConfigurations only.
const additionalCFG: Cfg[] = [{ id:'L',rt:'wavm',be:'llvm-jit',ver:'not collected',kind:'optimizing JIT',col:'var(--rt-wavm, var(--fg3))',hollow:false }];
export const CFG: Cfg[] = [...applicationCFG,...additionalCFG];
export const FEATURE_CFG: Cfg[] = CFG;
export const FEATURE_ENGINES = ['v8',...SA];
const shortVersion=(version:string)=>version.startsWith('binary-sha256:')?'sha256:'+version.slice(14,26):version.length>32?version.slice(0,12):version;

for(const c of FEATURE_CFG) {
  const measured=viewData.hosts.m1.configurations[c.id] || viewData.hosts.m2.configurations[c.id];
  const released=[...viewData.featureVersions.m1,...viewData.featureVersions.m2].find(v=>v.id===viewData.configurations[c.id] && v.channel==='stable' && v.description.runtime_version===measured?.version);
  if(measured && (released || !/^[a-f0-9]{40}(?:\/|$)|nightly|snapshot|canary|0\.0\.0-prerelease/i.test(measured.version))){c.ver=shortVersion(released?.version || measured.version);c.be=c.id==='R'?measured.backend+' + async':c.rt==='v8'&&measured.backend==='optimizing-only'?'turboshaft':measured.backend;}
  if(c.id==='E'||c.id==='G'){c.interp=false;c.kind='JIT compiler';}
}
for(const runtime of RTS) {
  const c=FEATURE_CFG.find(c=>c.rt===runtime.id);
  if(c){runtime.rel=c.ver;runtime.size='not measured';}
  else {runtime.rel='not collected';runtime.size='not measured';}
  if(runtime.id==='wazero')runtime.notes=runtime.notes.filter(note=>!note.includes('interpreter mode'));
  if(runtime.id==='wago'){
    runtime.exec=['JIT'];runtime.tiers='Railshot';
    runtime.wasi='0.1 · 0.2 (plugin)';runtime.cm='y';
    runtime.repo='github.com/wago-org/wago';
    runtime.notes=[
      'Measured Railshot compiler configuration; exact source identity is recorded per report.',
      'WASI Preview 1 and WASI 0.2 are available through the experimental wago-org/wasi plugin.',
      'Component Model execution and Canonical ABI linking are available through wago-org/component-model; WASI Preview 2 selects this dependency.',
      'Core WASI command benchmarks use the provider configuration recorded in each report; official WASI and Component Model conformance is measured separately.'
    ];
  }
}
export const WF: Record<CfgId,number> = {A:1,B:1,C:1,D:1,E:1,F:1,G:1,H:1,I:1,J:1,K:1,L:1,M:1,N:1,O:1,P:1,Q:1,R:1,S:1};
export const MACH: Record<MachineId,Machine> = Object.fromEntries(Object.entries(viewData.hosts).map(([id,h])=>[id,{
  l:h.label,os:h.os,f:{},off:Object.fromEntries(FEATURE_CFG.filter(c=>!h.configurations[c.id]).map(c=>[c.id,'Configuration not collected on this host']))
}])) as Record<MachineId,Machine>;

export const CB = Object.fromEntries(FEATURE_CFG.map((c) => [c.id, c])) as Record<CfgId, Cfg>;

export function configVersion(machine:MachineId,id:CfgId){
  const version=viewData.hosts[machine].configurations[id]?.version;
  return version?shortVersion(version):'not collected';
}
