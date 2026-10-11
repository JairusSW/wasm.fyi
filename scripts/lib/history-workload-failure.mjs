import {workloadContract} from './workload-contract.mjs';

export const workloadBudgetMs=300000;

export function historyWorkloadFailure({workload,job,platform,error,signal,capturedAt=new Date().toISOString()}) {
 const causes=[];let cause=error;
 for(let depth=0;cause&&depth<8;depth++,cause=cause.cause)causes.push(String(cause));
 const timedOut=signal?.reason?.name==='TimeoutError'||causes.some(reason=>/^TimeoutError:/.test(reason));
 const note={capturedAt,source:job.source,engine:job.displayEngine||job.engine,workload:workload.id,kind:timedOut?'timeout':'capture-error',budgetMs:workloadBudgetMs,reason:String(error),causes};
 const contractSha256=workloadContract(workload);
 const capture={capturedAt,source:job.source,platform,results:['compile','instantiate','first-call','steady'].map(phase=>({workload:workload.id,wasm:workload.artifactName,artifactSha256:workload.sha256,contractSha256,engine:job.displayEngine||job.engine,version:job.source.revision,backend:job.backend||(job.engine==='v8'&&['explicit-flag','mandatory-source-default'].includes(job.env?.WASMBENCH_V8_TURBOSHAFT_POLICY)?'turboshaft':job.engine),phase,timingSamples:0,latencyStatus:'failed',latencyNs:null,memoryStatus:'not-measured',peakRssBytes:null,codeStatus:'not-measured',codeBytes:null,codeKind:null}))};
 return {capture,note};
}
