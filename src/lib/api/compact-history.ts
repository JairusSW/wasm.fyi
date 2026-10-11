import type {Source} from './benchmark-types';
import type {OtMetricKey} from '../data/types';

export type HistoricalChange={engine:string;fromDate:string;toDate:string;before:number|null;after:number|null;ratio:number|null;count:number;reference:number;reused:boolean};
export type HistoricalLane={engine:string;value:number|null;count:number;reference:number;source?:Source;version:string;backend:string;latestCreated:string;fingerprint:string;calls?:{hostWasm:number|null;wasmHostLoop:number|null};previous?:HistoricalChange;first?:HistoricalChange};
export type HistoricalSummary={revision:string;platform:string;metric:OtMetricKey;workloads:string[];items:{date:string;lanes:HistoricalLane[]}[]};
export type HistoricalComparison={revision:string;fromDate:string;toDate:string;items:HistoricalChange[]};

export function historyFactor(metric:OtMetricKey){return metric==='mem'?1024**2:metric==='code'?1024:metric==='cov'?1:1e6}
export function scaledChange(change:HistoricalChange,metric:OtMetricKey){
 if(change.before==null||change.after==null||change.ratio==null)return null;
 const factor=historyFactor(metric);
 return {before:change.before/factor,after:change.after/factor,ratio:change.ratio,count:change.count,reused:change.reused};
}

export type HistoricalReport={revision:string;engine:string;fromDate:string;toDate:string;items:{workload:string;group:string;before:number;after:number;ratio:number;reused:boolean}[]};
