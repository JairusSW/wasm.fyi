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
  code: { l: 'Extracted native image', short: 'Native code', g: 'code', c: 3, u: 'KiB' }
};
export const PHASE_NOTE: Record<MetricKey, string> = {
  compile: 'Compilation: validation + code generation until the module object is ready. Lazy and tiered backends report only work done before instantiation; interpreters report translation.',
  rssCompile: 'Peak process RSS during one separate compile-only memory run. Compile latency uses three samples per launch; RSS is one sample and is not folded into latency.',
  inst: 'Instantiation: imports resolved, memories/tables allocated, data/elem segments applied, and the module start function invoked if one is declared. An exported _start is not part of instantiation.',
  rssInst: 'Peak process RSS during one separate instantiate-only memory run. Instantiation latency uses three samples per launch; RSS is one sample and is not folded into latency.',
  first: 'First call: the first invocation of the entry export (e.g. _start), measured separately. Includes lazy compilation and tier-up triggered by the call.',
  steady: 'Steady execution: verified embedding calls; independent launch counts and warmup policy are recorded in the linked report.',
  rss: 'Process lifetime peak RSS from a separate matched memory pass. Includes adapter and runtime; no phase subtraction or heap substitution.',
  code: 'Pinned extracted native image bytes, including its reported wrappers and data. Unavailable collectors remain not measured; this is not active function code or cumulative emission.',
};
