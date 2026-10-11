import {qualifiedEngineFatalAtRoot} from './qualified-engine-failure.mjs';
// Completed capture files can still contain failed adapter trials. Only known
// integration defects hold the schedule; genuine unsupported cases and bounded
// workload timeouts remain recorded outcomes.
export function historyIntegrationFailure(error) {
 const text=[error?.error,error?.reason,...(error?.failures||[]).map(f=>f.reason)].filter(Boolean).join('; ');
 // These messages describe absent harness support, not an engine rejection.
 // Keep them pending until the adapter works or an engine-specific limitation
 // is proved; a generic "unsupported" prefix does not settle that question.
 if (/unsupported: extended workload contract host_profile|ordered vector timing capability\/profile not supported/i.test(text)) return true;
 return /SDK API unavailable|java\.lang\.(?:NoSuchMethodException|NoSuchMethodError|NoClassDefFoundError)|ERR_MODULE_NOT_FOUND|Cannot find module ['"]|Missing resumed failure (?:note|details)|protocol version or request identity mismatch|Invalid request JSON|Invalid ordered latency samples|Producer returned an incomplete adaptive sample sequence|Invalid sample cap|adapter startup|SDK startup qualification failed|invalid control response|adapter terminated before response|missing.*(?:header|shared librar)|fatal error:.*No such file or directory/i.test(text);
}
export function completedHistoryIntegrationFailures(status,engine,week,root) {
 return (status.completed||[]).filter(done=>(!done.engine||done.engine===engine)&&(!done.asOf||new Date(done.asOf).toISOString()===week))
  .flatMap(done=>(done.workloadErrors||[]).filter(error=>historyIntegrationFailure(error)&&!qualifiedEngineFatalAtRoot(error,done,root)).map(error=>({...error,pinKey:done.pinKey,configuration:done.configuration})));
}
