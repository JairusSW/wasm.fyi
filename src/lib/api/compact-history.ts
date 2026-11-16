import type {Source} from './benchmark-types';
import type {OtMetricKey} from '../data/types';

export type HistoricalChange={engine:string;fromDate:string;toDate:string;before:number|null;after:number|null;ratio:number|null;count:number;reference:number;reused:boolean};
export type HistoricalLane={engine:string;value:number|null;count:number;reference:number;source?:Source;version:string;backend:string;latestCreated:string;fingerprint:string;calls?:{hostWasm:number|null;wasmHostLoop:number|null};previous?:HistoricalChange;first?:HistoricalChange;/** Date of the measurement repeated at a later point. */carried?:string};
export type HistoricalSummary={revision:string;platform:string;metric:OtMetricKey;workloads:string[];items:{date:string;lanes:HistoricalLane[]}[]};
export type HistoricalComparison={revision:string;fromDate:string;toDate:string;items:HistoricalChange[]};

export function historyFactor(metric:OtMetricKey){return metric==='mem'?1024**2:metric==='code'?1024:metric==='cov'?1:1e6}
export function scaledChange(change:HistoricalChange,metric:OtMetricKey){
 if(change.before==null||change.after==null||change.ratio==null)return null;
 const factor=historyFactor(metric);
 return {before:change.before/factor,after:change.after/factor,ratio:change.ratio,count:change.count,reused:change.reused};
}

export type HistoricalReport={revision:string;engine:string;fromDate:string;toDate:string;items:{workload:string;group:string;before:number;after:number;ratio:number;reused:boolean}[]};

/**
 * Points after an engine's last measurement repeat that measurement (flagged
 * `carried`), so the newest dates of a campaign still in progress show every
 * engine at its latest available version instead of only those re-measured.
 */
export function carryLatestAvailable(summary:HistoricalSummary):HistoricalSummary{
 const last=new Map<string,number>();
 summary.items.forEach((point,i)=>{for(const lane of point.lanes)if(lane.value!=null&&lane.count>0)last.set(lane.engine,i)});
 if(![...last.values()].some(at=>at<summary.items.length-1))return summary;
 return {...summary,items:summary.items.map((point,i)=>{
  const carry=new Map([...last].filter(([,at])=>at<i).map(([engine,at])=>[engine,{...summary.items[at].lanes.find(l=>l.engine===engine)!,previous:undefined,first:undefined,carried:summary.items[at].date}]));
  if(!carry.size)return point;
  const lanes=point.lanes.map(lane=>carry.get(lane.engine)??lane);
  for(const [engine,lane] of carry)if(!point.lanes.some(l=>l.engine===engine))lanes.push(lane);
  return {...point,lanes};
 })};
}
