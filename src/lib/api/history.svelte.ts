import type {WireRecord} from './types';
import type {Scope} from '../model';
import type {CfgId,OtMetricKey} from '../data/types';
import {localDate} from './calendar-date';
export type TimelineLane={track:string;value:number|null;measured:number;reference:number;version:string;configuration:string;collectedAt:string;role:string;release:{version:string;publishedAt:string;url:string}|null;sourceReports:number;reports:string[];evidence:string};
export type Timeline={revision:string;items:{date:string;lanes:TimelineLane[]}[];changes:{track:string;before:number|null;after:number|null;count:number}[];reference:number;policy:string;timeAxis:string;uncertainty:string};
export type HistoryReport={revision:string;workloads:{workload:string;group:string;before:WireRecord;after:WireRecord;ratio:number;reused:boolean}[];total:number;nextCursor:string;summaryCounts:Record<string,number>};
export const historyKey=(scope:Scope,metric:OtMetricKey,workload='')=>JSON.stringify([scope.machine,scope.baseline,scope.weighting,Object.keys(scope.hide).filter(k=>scope.hide[k as CfgId]).sort(),metric,workload,apiHistory.from,apiHistory.until]);
export const apiHistory=$state({report:null as HistoryReport|null,reportKey:'',reportLoading:false,reportError:'',loading:false,error:'',from:'2024-10-01',until:localDate(),captureDates:{} as Record<string,string[]>,series:{} as Record<string,Timeline>,changes:{} as Record<string,{before:number;after:number;ratio:number;count:number}>,active:{} as Record<string,string>,slots:{} as Partial<Record<CfgId,string>>});
export function timelineLane(scope:Scope,cid:CfgId,metric:OtMetricKey,index:number,workload=''){return apiHistory.series[historyKey(scope,metric,workload)]?.items[index]?.lanes.find(l=>l.track===apiHistory.slots[cid])}
