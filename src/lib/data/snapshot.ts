import {shortVersion} from '../version-identity';
import {CALL_PATHS} from '../call-paths';
import {datasetView} from '../api/view.svelte';
import {liveArray} from '../api/live-array';
// Catalogue, metric labels and retrospective dates backed by sealed evidence.
import { viewData } from '../view-data';
import type { Bench, BenchGroup, CfgId, MachineId, MetricKey, OtMetric, OtMetricKey, OvGroup, OvKey, Snap, SnapEvent, Status } from './types';

export const OV: Record<OvKey, OvGroup> = {
  lat:{label:'Latency',cols:['Compilation','Instantiation','First call','Steady execution'],metrics:['compile','inst','first','steady']},
  calls:{label:'Call latency',cols:[...CALL_PATHS.map(p=>p.label),'Total'],metrics:['steady','steady','steady']},
  mem:{label:'Memory',cols:['Compile run peak RSS','Instantiate run peak RSS','Steady run peak RSS','Average phase peak RSS'],metrics:['rssCompile','rssInst','rss','rss']},
  code:{label:'Machine Code',cols:['Native code size','Cumulative emitted'],metrics:['code','code']},
  cov:{label:'Correctness',cols:['Correct','Failed','Crashed / timeout','Unsupported / disabled','Not measured'],metrics:['steady','steady','steady','steady','steady']}
};
export const UNIT: Record<"lat" | "mem" | "code", string> = { lat: 'ms', mem: 'MiB', code: 'KiB' };
export const OTM: Record<OtMetricKey, OtMetric> = {
  exec: { key: 'exec', l: 'Steady execution', g: 'lat', c: 3, u: 'ms', k: 1 },
  callTotal: {key:'callTotal',l:'Total call latency',g:'lat',c:3,u:'ms',k:1},
  wasmHostLoop: { key: 'wasmHostLoop', l: CALL_PATHS[0].label, g: 'lat', c: 3, u: 'ms', k: 1 },
  hostWasm: { key: 'hostWasm', l: CALL_PATHS[1].label, g: 'lat', c: 3, u: 'ms', k: 1 },
  compile: { key: 'compile', l: 'Compilation', g: 'lat', c: 0, u: 'ms', k: 0.6 },
  inst: { key: 'inst', l: 'Instantiation', g: 'lat', c: 1, u: 'ms', k: 0.3 },
  mem: { key: 'mem', l: 'Memory', g: 'mem', c: 2, u: 'MiB', k: 0.4 },
  code: { key: 'code', l: 'Machine Code', g: 'code', c: 3, u: 'KiB', k: 0.5 },
  cov: { key: 'cov', l: 'Correctness', g: 'cov', c: 0, u: 'n', k: 0 },
};
export const OTM_KEYS: OtMetricKey[] = Object.keys(OTM).filter(key=>!['hostWasm','wasmHostLoop'].includes(key)) as OtMetricKey[];
export const SNAPS: Snap[] = liveArray(()=>viewData.history[datasetView.machine].points.map((p,i)=>({i,date:p.date,short:p.date.slice(5)})));
export const HARNESS_BREAK=0;
export const historyPin=(machine:MachineId)=>Math.max(0,viewData.history[machine].points.findIndex(p=>p.status==='measured'));
export const EVENTS:SnapEvent[]=liveArray(()=>viewData.history[datasetView.machine].points.map((p,i)=>({i,kind:'revision' as const,label:`Retrospective source snapshot ${p.date}`})));
export const verAt=(cid:CfgId,i:number,machine:'m1'|'m2'|'m3'='m1')=>{
  const v=viewData.history[machine].versions[cid]?.[i];
  const h=viewData.history[machine];
  if(datasetView.revision)return v&&/^[a-f0-9]{40}$/.test(v)?shortVersion(v):v||'not collected';
  const historical=h.workloads.some(w=>h.cells[`${w}|${cid}|steady`]?.[i]?.role==='retrospective-revision');
  return historical?(v && /^[a-f0-9]{40}$/.test(v)?shortVersion(v):v?shortVersion(v):'not collected'):v && v!=='not collected'?`fixed ${shortVersion(v)}`:'not collected';
};
export const BENCH: BenchGroup[] = liveArray(()=>[...new Set(viewData.catalogue.map(b=>b.group))].map(g=>({
  g, items:viewData.catalogue.filter(b=>b.group===g), total:viewData.catalogue.filter(b=>b.group===g).length
})));
export const ALLB: Bench[] = liveArray(()=>BENCH.flatMap(g => g.items.map(b => ({ ...b, group: g.g }))));
export const ST_OVR: Record<string, Status> = {};
export { MET, PHASE_NOTE } from './metrics';
export const PH_NAMES:string[]=['startup','compile','instantiate','first call','steady','teardown'];
