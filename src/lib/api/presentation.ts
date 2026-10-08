import {CALL_LOOP_WORKLOAD,CALL_LOOP_ITERATIONS,CALL_MIN_BATCH_NS} from '../call-paths';
import type {ResultData, WireRecord} from './types';
import type {MetricKey, Status} from '../data/types';

export type CellSummary = {
 id:string; report:string; contract:string; configuration:string; track:string;
 environment:string; created:string; metric:string; scenario:string; profile:string;
 definition:string; method?:string; analysis:string; st:Status; v?:number;
 interval?:[number,number]; reason:string; exactValue?:number|string;
 approximate:boolean; artifact?:string;
};
export const metricSelectors:Record<MetricKey,{metric:string;scenario:string;statistic:string;factor:number}>= {
 compile:{metric:'time.wall',scenario:'compile',statistic:'median_ns_per_operation',factor:1e6},
 inst:{metric:'time.wall',scenario:'instantiate',statistic:'median_ns_per_operation',factor:1e6},
 first:{metric:'time.wall',scenario:'first-call',statistic:'median_ns_per_operation',factor:1e6},
 steady:{metric:'time.wall',scenario:'steady',statistic:'median_ns_per_operation',factor:1e6},
 rssCompile:{metric:'process.peak_rss',scenario:'compile',statistic:'median_bytes',factor:1024**2},
 rssInst:{metric:'process.peak_rss',scenario:'instantiate',statistic:'median_bytes',factor:1024**2},
 rss:{metric:'process.peak_rss',scenario:'steady',statistic:'median_bytes',factor:1024**2},
 code:{metric:'native.code_size',scenario:'compile',statistic:'size_bytes',factor:1024}
};
export const detailSelectors={...metricSelectors,rssFirst:{metric:'process.peak_rss',scenario:'first-call',statistic:'median_bytes',factor:1024**2}};
export function sourceNumber(raw:unknown):{value:number;exact:number|string;approximate:boolean}|null {
 if(raw==null)return null;
 if(typeof raw!=='number'&&typeof raw!=='string')throw new Error('Invalid producer number');
 if(typeof raw==='string'&&!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw))throw new Error('Invalid producer number');
 const value=Number(raw);if(!Number.isFinite(value))throw new Error('Producer number exceeds display range');
 const approximate=typeof raw==='string'&&/^-?[0-9]+$/.test(raw)
  ? BigInt(raw)>BigInt(Number.MAX_SAFE_INTEGER)||BigInt(raw)<BigInt(Number.MIN_SAFE_INTEGER)
  : Number.isInteger(value)&&!Number.isSafeInteger(value);
 return {value,exact:raw,approximate};
}
function sourceStatus(data:ResultData):{st:Status;reason:string} {
 const summary=data.summary;
 const reason=String(summary.latency_reason||summary.reason||summary.size_note||'');
 const status=String(summary.latency_status||summary.status||'');
 const names:Record<string,Status>={ok:'ok',available:'ok',failed_cell:'failed',unsupported:'unsupported',disabled:'disabled',failed:'failed',crashed:'crashed',timeout:'timeout',unavailable:'unavail',not_measured:'nm',not_applicable:'na'};
 const outcomes=summary.outcomes as Record<string,unknown>|null;
 for(const [outcome,count] of Object.entries(outcomes||{}))if(Number(count)>0&&!['ok','unsupported'].includes(outcome))return {st:names[outcome]||'failed',reason:reason||`${outcome} source launches`};
 if(Number(outcomes?.unsupported||0)>0&&!(Number(outcomes?.ok||0)>0))return {st:'unsupported',reason:reason||'No successful launch was recorded'};
 return {st:names[status]||(summary[data.statistic]!=null?'ok':'nm'),reason};
}
/** Display conversion only. Source values/identities are retained; no resampling. */
export function presentResult(record:WireRecord):CellSummary {
 if(record.kind!=='result')throw new Error('Expected a result record');
 const data=record.data as ResultData;
 const callbackLoop=data.workload===CALL_LOOP_WORKLOAD&&data.metric==='time.wall'&&['steady','first-call'].includes(data.scenario);
 const factor=data.metric==='time.wall'?1e6*(callbackLoop?CALL_LOOP_ITERATIONS:1):data.metric.startsWith('process.')?1024**2:data.metric.startsWith('native.')?1024:1;
 const status=sourceStatus(data);
 if(callbackLoop&&data.scenario==='steady'&&status.st==='ok'&&Number(data.summary.min_batch_elapsed_ns||0)<CALL_MIN_BATCH_NS){status.st='nm';status.reason='Callback-loop batches must contain at least 0.5 ms of timed work'}
 const raw=sourceNumber(data.summary[data.statistic]);
 if(data.metric.startsWith('native.')&&raw)status.st='ok';
 if(data.metric==='time.wall'&&status.st==='ok'&&raw&&raw.value<=0){status.st='nm';status.reason='The operation completed below the timing clock resolution'}
 const low=sourceNumber(data.summary[data.metric==='time.wall'?'ci95_low':'ci95_low_bytes']);
 const high=sourceNumber(data.summary[data.metric==='time.wall'?'ci95_high':'ci95_high_bytes']);
 if(low&&high&&low.value>high.value)throw new Error('Invalid producer interval');
 return {id:record.id,report:data.reportId,contract:data.contractId,configuration:data.configurationId,track:data.trackId,
  environment:data.environmentId,created:data.created,metric:data.metric,scenario:data.scenario,profile:data.profile,
  definition:data.metricDefinitionId,method:data.measurementMethodId,analysis:data.analysisVersion,
  ...status,...(raw?{exactValue:raw.exact}:{}),...(status.st==='ok'&&raw?{v:raw.value/factor}:{}),
  ...(status.st==='ok'&&low&&high?{interval:[low.value/factor,high.value/factor] as [number,number]}:{}),
  approximate:!!raw?.approximate,...(typeof data.summary.artifactId==='string'?{artifact:data.summary.artifactId}:{})};
}
