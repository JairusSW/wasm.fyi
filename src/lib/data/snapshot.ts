// Catalogue, metric labels and retrospective dates backed by sealed evidence.
import { viewData } from '../view-data';
import type { Bench, BenchGroup, CfgId, MetricKey, OtMetric, OtMetricKey, OvGroup, OvKey, Snap, SnapEvent, Status } from './types';

export const OV: Record<OvKey, OvGroup> = {
  compile:{label:'Compilation latency',cols:['Compilation'],metrics:['compile']},
  calls:{label:'Call latency',cols:['Wasm → host','Host → Wasm'],metrics:['steady','steady']},
  lat:{label:'Runtime latency',cols:['Instantiation','First call','Steady execution'],metrics:['inst','first','steady']},
  mem:{label:'Memory',cols:['Compile run peak RSS','Instantiate run peak RSS','Steady run peak RSS','Retained @ +1 s'],metrics:['rssCompile','rssInst','rss','rss']},
  code:{label:'Machine Code',cols:['Function code','Stubs & trampolines','Metadata & pools','Extracted native image','Cumulative emitted'],metrics:['code','code','code','code','code']},
  cov:{label:'Correctness',cols:['Correct','Failed','Crashed / timeout','Unsupported / disabled','Not measured'],metrics:['steady','steady','steady','steady','steady']}
};
export const UNIT: Record<"lat" | "mem" | "code", string> = { lat: 'ms', mem: 'MiB', code: 'KiB' };
export const OTM: Record<OtMetricKey, OtMetric> = {
  exec: { key: 'exec', l: 'Execution', g: 'lat', c: 3, u: 'ms', k: 1 },
  compile: { key: 'compile', l: 'Compilation', g: 'lat', c: 0, u: 'ms', k: 0.6 },
  inst: { key: 'inst', l: 'Instantiation', g: 'lat', c: 1, u: 'ms', k: 0.3 },
  mem: { key: 'mem', l: 'Memory', g: 'mem', c: 2, u: 'MiB', k: 0.4 },
  code: { key: 'code', l: 'Machine Code', g: 'code', c: 3, u: 'KiB', k: 0.5 },
  cov: { key: 'cov', l: 'Correctness', g: 'cov', c: 0, u: 'n', k: 0 },
};
export const OTM_KEYS = Object.keys(OTM) as OtMetricKey[];
export const SNAPS: Snap[] = viewData.history.m1.points.map((p,i)=>({i,date:p.date,short:p.date.slice(5)}));
export const HARNESS_BREAK=0;
export const PIN=0;
export const EVENTS:SnapEvent[]=viewData.history.m1.points.map((p,i)=>({i,kind:'revision',label:`Retrospective Wago revision ${p.revision.slice(0,12)}`}));
export const verAt=(cid:CfgId,i:number,machine:'m1'|'m2'='m1')=>{
  const v=viewData.history[machine].versions[cid]?.[i];
  return cid==='G'?v?.slice(0,12) || 'not collected':v && v!=='not collected'?`fixed ${v}`:'not collected';
};
export const BENCH: BenchGroup[] = [...new Set(viewData.catalogue.map(b=>b.group))].map(g=>({
  g, items:viewData.catalogue.filter(b=>b.group===g), total:viewData.catalogue.filter(b=>b.group===g).length
}));
export const ALLB: Bench[] = BENCH.flatMap(g => g.items.map(b => ({ ...b, group: g.g })));
export const ST_OVR: Record<string, Status> = {};
export { MET, PHASE_NOTE } from './metrics';
export const PH_NAMES:string[]=['startup','compile','instantiate','first call','steady','teardown'];
