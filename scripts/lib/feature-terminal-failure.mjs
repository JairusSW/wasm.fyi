const terminated=/^(?:(?:sacrificial check [a-zA-Z0-9_-]+|adaptive phase (?:compile|instantiate|first-call|steady)): )?adapter terminated before response \(see trial log\)$/;

// Once an exact engine binding has already completed another workload, two
// matching termination observations for one feature artifact are a runtime
// outcome. Keep the cell failed, but do not hold every unrelated feature.
export function terminalFeatureRuntimeFailure(note,{engineQualified=false}={}){
 if(!engineQualified||note?.kind!=='failed-trials'||!note.workload?.startsWith('features/')||!note.engine||!note.failures?.length)return false;
 const statuses=new Set(note.failures.map(f=>f.status));
 return statuses.has('preflight_failed')&&statuses.has('error')&&note.failures.every(f=>f.engine===note.engine&&f.workload===note.workload&&terminated.test(f.reason||''));
}
