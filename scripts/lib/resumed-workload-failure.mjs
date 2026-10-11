// Reusing a capture must preserve unresolved failures without rerunning it.
export function restoredWorkloadFailure(capture,note,job,workload) {
 const phases=[...new Set((capture?.results||[]).filter(row=>row.latencyStatus==='failed').map(row=>row.phase))];
 if(!phases.length)return null;
 const base={engine:job.displayEngine||job.engine,source:job.source.ref,asOf:job.source.asOf,workload:workload.id,phases};
 if(!note||note.workload!==workload.id||note.engine!==base.engine||note.source?.revision!==job.source.revision||note.source?.asOf!==job.source.asOf)
  return {...base,error:'Missing resumed failure note with matching workload and source identity',kind:'missing-failure-note'};
 if(Array.isArray(note.failures)&&note.failures.length){
  const remaining=note.failures.filter(f=>phases.includes(f.phase));
  const reasons=remaining.map(f=>f.reason).filter(Boolean);
  if(!reasons.length)return {...base,error:'Missing resumed failure details for unresolved phases',kind:'missing-failure-details'};
  return {...base,error:reasons.join('; '),kind:note.kind};
 }
 if(!note.reason)return {...base,error:'Missing resumed failure details for unresolved phases',kind:'missing-failure-details'};
 return {...base,error:note.reason,kind:note.kind,...(note.budgetMs?{budgetMs:note.budgetMs}:{})};
}
