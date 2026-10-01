// Benchmark snapshot: aggregates, corpus, per-phase data and proposal workloads.
// Workload catalogue and cells use sealed evidence; remaining aggregate and
// proposal providers below are pending replacement before frontend publication.
import { viewData } from '../view-data';
import type { Bench, BenchGroup, CfgId, MetricKey, OtMetric, OtMetricKey, OvGroup, OvKey, Snap, SnapEvent, Status } from './types';

export const GC_W: [string, string, number][] = [['binary-trees', 'depth 18 · short-lived nodes', 1], ['kotlin-maps', 'HashMap churn · Kotlin/Wasm', .7], ['dart-json', 'JSON decode → object graph · Dart', .45], ['graph-longlived', '1M-node live graph, random mutation', .3]];
export const GC_D: Record<CfgId, { thr?: number; ratio?: number; col?: string; st?: string }> = { A: { thr: 142, ratio: 2.9, col: 'DRC (deferred ref-counting)' }, B: { thr: 96, ratio: 3.0, col: 'DRC' }, F: { thr: 388, ratio: 1.7, col: 'generational (Orinoco)' }, C: { st: 'fails correctness', col: 'flag' }, D: { st: 'disabled (flag)', col: '—' }, E: { st: 'unsupported' }, G: { st: 'unsupported' } };
export const M64_D: Partial<Record<CfgId, [number, number, boolean?]>> = { A: [8.1, 3.2], B: [11.4, 2.1], F: [6.2, 1.8], C: [4.9, 6.0, true] };
export const M64_W: [string, string][] = [['sqlite-speedtest1', 'wasm64 vs wasm32 build, same input'], ['memcpy-256MiB', 'bulk-memory copy'], ['pointer-chase-64MiB', 'dependent loads']];
export const THR_D: Partial<Record<CfgId, number[]>> = { A: [1, 1.94, 3.7, 6.8, 10.9, 2.1, 1.9], B: [1, 1.95, 3.72, 6.7, 10.4, 2.0, 1.9], C: [1, 1.96, 3.8, 7.1, 11.6, 3.4, 2.2], D: [1, 1.9, 3.5, 6.1, 8.7, 3.1, 1.7], F: [1, 1.92, 3.6, 6.5, 9.8, 1.6, 2.0] };
export const OV: Record<OvKey, OvGroup> = {
  lat: { label: 'Latency', cols: ['Compilation', 'Instantiation', 'First call', 'Steady execution'], metrics: ['compile', 'inst', 'first', 'steady'], vals: {
    A: [[1, .03], [1, .04], [1, .05], [1, .02]], B: [[.21, .01], [.97, .05], [.80, .06], [2.9, .08]], C: [[6.8, .3], [.62, .05], [.41, .03], [.93, .03]],
    D: [[.34, .02], [1.04, .05], [.9, .06], [2.4, .07]], E: [[.04, .004], [.88, .06], [3.1, .2], [28.4, 1.4]], F: [[.12, .01], [1.41, .07], [.70, .05], [1.12, .04]], G: [[.06, .005], [.66, .06], [2.4, .15], [11.6, .6]] } },
  mem: { label: 'Memory', cols: ['Compile peak Δ', 'Instantiate peak Δ', 'Execution peak Δ', 'Retained @ +1 s'], metrics: ['rss', 'rss', 'rss', 'rss'], vals: {
    A: [[1, .04], [1, .03], [1, .03], [1, .06]], B: [[.44, .03], [.98, .03], [1.03, .03], [.81, .05]], C: [[2.9, .12], [.74, .04], [.96, .03], [1.9, .1]],
    D: [[.51, .03], [1.01, .03], [1.05, .03], [.86, .05]], E: [[.12, .01], [.93, .04], [1.10, .04], [.42, .03]], F: [[.38, .03], [1.22, .05], [1.31, .05], [1.12, .07]], G: [[.15, .01], [.64, .03], [.97, .03], [.39, .03]] } },
  code: { label: 'Machine Code', cols: ['Function code', 'Stubs & trampolines', 'Metadata & pools', 'Active total', 'Cumulative emitted'], metrics: ['code', 'code', 'code', 'code', 'code'], vals: {
    A: [[1, .01], [1, .01], [1, .01], [1, .01], [1, .01]], B: [[1.71, .01], [1.1, .01], [1.3, .01], [1.62, .01], [1.62, .01]], C: [[.84, .01], [.62, .01], [1.4, .01], [.96, .01], [.96, .01]],
    D: [[2.2, .01], [1.2, .01], [1.5, .01], [2.1, .01], [2.1, .01]], E: null, F: [[.86, .01], [1.3, .01], [1.1, .01], [.91, .01], [1.64, .01]], G: null } },
  cov: { label: 'Correctness', cols: ['Correct', 'Failed', 'Crashed / timeout', 'Unsupported / disabled', 'Not measured'], metrics: ['steady', 'steady', 'steady', 'steady', 'steady'], vals: {
    A: [1261, 4, 1, 18, 0], B: [1261, 4, 1, 18, 0], C: [1240, 2, 9, 18, 15], D: [1198, 11, 3, 72, 0], E: [1179, 6, 2, 97, 0], F: [1270, 3, 0, 11, 0], G: [1152, 21, 14, 97, 0] } },
};
export const REF: Record<"lat" | "mem" | "code", number[]> = { lat: [41.2, 0.186, 2.14, 0.0049], mem: [38.4, 6.2, 21.7, 3.9], code: [612, 48, 96, 756, 756] };
export const UNIT: Record<"lat" | "mem" | "code", string> = { lat: 'ms', mem: 'MB', code: 'KB' };
export const OTM: Record<OtMetricKey, OtMetric> = {
  exec: { key: 'exec', l: 'Execution', g: 'lat', c: 3, u: 'ms', k: 1 },
  compile: { key: 'compile', l: 'Compilation', g: 'lat', c: 0, u: 'ms', k: 0.6 },
  inst: { key: 'inst', l: 'Instantiation', g: 'lat', c: 1, u: 'ms', k: 0.3 },
  mem: { key: 'mem', l: 'Memory', g: 'mem', c: 2, u: 'MB', k: 0.4 },
  code: { key: 'code', l: 'Machine Code', g: 'code', c: 3, u: 'KB', k: 0.5 },
  cov: { key: 'cov', l: 'Correctness', g: 'cov', c: 0, u: 'n', k: 0 },
};
export const OTM_KEYS = Object.keys(OTM) as OtMetricKey[];
export const SNAPS: Snap[] = Array.from({ length: 16 }, (_, i) => { const d = new Date(Date.UTC(2026, 5, 15 + 7 * i)); const iso = d.toISOString().slice(0, 10); return { i, date: iso, short: iso.slice(5) }; });
export const HARNESS_BREAK = 0;
export const PIN = 6;
export const EVENTS: SnapEvent[] = [
  { i: 10, kind: 'release', label: 'wasmtime 37.0.0' },
  { i: 11, kind: 'corpus', label: 'corpus 2026.08 (+14; cohort frozen)' },
  { i: 13, kind: 'release', label: 'v8 14.1.146 · wasmtime 37.0.1' },
];
export const verAt = (cid: CfgId, i: number): string => ({ A: i < 10 ? '36.0.2' : i < 13 ? '37.0.0' : '37.0.1', B: i < 10 ? '36.0.2' : i < 13 ? '37.0.0' : '37.0.1', C: i < 8 ? '6.0.1' : '6.1.0', D: i < 8 ? '6.0.1' : '6.1.0', E: '1.9.0', F: i < 13 ? '14.0.365' : '14.1.146', G: i < 9 ? '0.4.1' : '0.4.2' }[cid]);
export const BENCH: BenchGroup[] = [...new Set(viewData.catalogue.map(b=>b.group))].map(g=>({
  g, items:viewData.catalogue.filter(b=>b.group===g), total:viewData.catalogue.filter(b=>b.group===g).length
}));
export const ALLB: Bench[] = BENCH.flatMap(g => g.items.map(b => ({ ...b, group: g.g })));
export const ST_OVR: Record<string, Status> = {};
export const MET: Record<MetricKey, { l: string; short: string; g: "lat" | "mem" | "code"; c: number; u: string }> = { compile: { l: 'Compilation', short: 'Compile', g: 'lat', c: 0, u: 'ms' }, inst: { l: 'Instantiation', short: 'Instantiate', g: 'lat', c: 1, u: 'ms' }, first: { l: 'First call', short: 'First call', g: 'lat', c: 2, u: 'ms' }, steady: { l: 'Steady execution (per iteration)', short: 'Steady exec', g: 'lat', c: 3, u: 'ms' }, rss: { l: 'Process lifetime peak RSS', short: 'Peak RSS', g: 'mem', c: 2, u: 'MB' }, code: { l: 'Extracted native image', short: 'Native code', g: 'code', c: 3, u: 'KB' } };
export const PHASE_NOTE: Record<MetricKey, string> = {
  compile: 'Compilation: validation + code generation until the module object is ready. Lazy and tiered backends report only work done before instantiation; interpreters report translation.',
  inst: 'Instantiation: imports resolved, memories/tables allocated, data/elem segments applied, and the module start function invoked if one is declared. An exported _start is not part of instantiation.',
  first: 'First call: the first invocation of the entry export (e.g. _start), measured separately. Includes lazy compilation and tier-up triggered by the call.',
  steady: 'Steady execution: verified embedding calls; independent launch counts and warmup policy are recorded in the linked report.',
  rss: 'Process lifetime peak RSS from a separate matched memory pass. Includes adapter and runtime; no phase subtraction or heap substitution.',
  code: 'Pinned extracted native image bytes, including its reported wrappers and data. Unavailable collectors remain not measured; this is not active function code or cumulative emission.',
};
export const MEMPH: Record<CfgId, { d: number[]; m: number[] }> = {
  A: { d: [6, 420, 1.2, 38, 1800, 12], m: [4.1, 96, 58, 76, 118, 131, 127, 22] },
  B: { d: [6, 88, 1.1, 30, 4900, 10], m: [4.1, 38, 30, 48, 90, 102, 99, 19] },
  C: { d: [6, 2860, 0.8, 16, 1680, 9], m: [4.1, 310, 72, 88, 128, 138, 135, 41] },
  D: { d: [6, 140, 1.2, 34, 4100, 11], m: [4.1, 44, 34, 52, 95, 106, 103, 20] },
  E: { d: [5, 18, 1.0, 110, 48000, 8], m: [3.8, 14, 12, 30, 74, 88, 86, 9] },
  F: { d: [6, 52, 1.6, 45, 2000, 14], m: [5.2, 36, 30, 50, 96, 142, 136, 34] },
  G: { d: [5, 11, 0.7, 70, 19500, 8], m: [3.6, 16, 14, 31, 73, 84, 82, 8] },
};
export const PH_NAMES: string[] = ['startup', 'compile', 'instantiate', 'first call', 'steady', 'teardown'];
export const CODE: Record<CfgId, (number | string | null)[] | null> = { A: [2410, 180, 320, '1,946 / 1,946', 'opt'], B: [4120, 210, 410, '1,946 / 1,946', 'baseline'], C: [2020, 110, 450, '1,946 / 1,946', 'AOT -O2'], D: [5300, 240, null, '1,946 / 1,946', 'single-pass'], E: null, F: [1960, 260, 380, '1,212 / 1,946 (lazy)', 'baseline + opt (hot)', 4880], G: null };
export const XW: Record<string, Record<CfgId, (number | null)[] | null>> = {
  'markdown-parse': { A: [38, .3, .9, .21, 3.1], B: [8, .3, 1.1, .55, 1.2], C: [610, .2, .4, .19, 2.4], D: [12, .3, 1.3, .48, 1.0], E: [1.4, .3, 6.2, 5.6, null], F: [4.8, .4, 2.8, .24, 1.9, 200, .9], G: null },
  'js-interp/richards': { A: [64, .4, 2.4, 1.9, 4.8], B: [13, .4, 4.1, 5.2, 1.8], C: [980, .3, 1.8, 1.7, 3.6], D: [20, .4, 4.6, 4.4, 1.5], E: [2, .4, 48, 46, null], F: [8, .5, 9, 2.1, 2.6, 30, 6.0], G: [1.4, .3, 22, 19, null] },
};
export const KER = [{ id: 'dot-f32', size: 'n = 4,096', s: 4.1, v: 1.2 }, { id: 'sad-u8', size: '16×16 blocks × 1,024', s: 38, v: 7.9 }, { id: 'matmul-f32', size: '64 × 64 × 64', s: 210, v: 61 }, { id: 'utf8-validate', size: '1 MiB input', s: 690, v: 118 }];
export const SIMD_M: Record<CfgId, [number, number | null]> = { A: [1, 1], B: [2.4, 2.2], C: [.78, .75], D: [3.5, 2.1], E: [15, null], F: [1.07, 1.08], G: [9.3, 24] };
export const SIMD_ISA: Record<CfgId, string> = { A: 'AVX2 + FMA (AVX-512 off by default)', B: 'SSE4.1', C: 'AVX-512 BW/VL', D: 'SSE4.1', E: '— SIMD unsupported', F: 'AVX2 + FMA', G: 'scalar emulation' };
export const SIMD_CC: Record<CfgId, [number, number | null] | null> = { A: [1, 1], B: [.2, 1.9], C: [7.1, .9], D: [.31, 2.6], E: null, F: [.11, .95], G: [.05, null] };
