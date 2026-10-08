// Shared by the UI and the build-time machine-readable exports.
import type { MetricKey } from './types';

export const MET: Record<MetricKey, { l: string; short: string; g: "lat" | "mem" | "code"; c: number; u: string }> = {
  compile: { l: 'Compilation', short: 'Compile', g: 'lat', c: 0, u: 'ms' },
  rssCompile: { l: 'Compile run peak RSS', short: 'Compile RSS', g: 'mem', c: 0, u: 'MiB' },
  inst: { l: 'Instantiation', short: 'Instantiate', g: 'lat', c: 1, u: 'ms' },
  rssInst: { l: 'Instantiate run peak RSS', short: 'Instantiate RSS', g: 'mem', c: 1, u: 'MiB' },
  first: { l: 'First call', short: 'First call', g: 'lat', c: 2, u: 'ms' },
  steady: { l: 'Steady execution (per iteration)', short: 'Steady exec', g: 'lat', c: 3, u: 'ms' },
  rss: { l: 'Steady run peak RSS', short: 'Steady RSS', g: 'mem', c: 2, u: 'MiB' },
  code: { l: 'Native code size', short: 'Native code', g: 'code', c: 3, u: 'KiB' }
};
export const PHASE_NOTE: Record<MetricKey, string> = {
  compile: 'Compilation: validation + code generation until the module object is ready. Lazy and tiered backends report only work done before instantiation; interpreters report translation. C AOT includes Wasm-to-C transpilation, GCC compilation/linking and library loading.',
  rssCompile: 'Process-lifetime peak RSS for compilation, from its recorded timing or memory source pass. Each trial supplies one RSS observation; inner timing samples do not add independent RSS observations.',
  inst: 'Instantiation: imports resolved, memories/tables allocated, data/elem segments applied, and the module start function invoked if one is declared. An exported _start is not part of instantiation.',
  rssInst: 'Process-lifetime peak RSS for instantiation, retaining its recorded source pass and collector. No phase subtraction or heap substitution.',
  first: 'First call: the first invocation of the entry export (e.g. _start), measured separately. Includes lazy compilation and tier-up triggered by the call.',
  steady: 'Steady execution after warmup; each plotted sample is normalized per iteration.',
  rss: 'Process-lifetime peak RSS from its recorded source pass. Includes adapter and runtime; timing-pass RSS stays tied to its trial. No phase subtraction or heap substitution.',
  code: 'Producer-reported native code size. Measurement, exported bytes and function inspection have separate availability. The record identifies whether size comes from an engine report or an extracted image.',
};
