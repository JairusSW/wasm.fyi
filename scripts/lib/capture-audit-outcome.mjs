// Infrastructure placeholders document an interrupted collector, not a runtime
// outcome. Stale notes must not invalidate subsequently measured replacements.
export function assertCapturedOutcome(capture,note){
 if(note?.kind==='capture-error'&&capture.results?.length&&capture.results.every(row=>row.latencyStatus==='failed'&&row.latencyNs==null&&!row.samplesNs?.length&&!row.timingSamples))throw Error('Unresolved capture infrastructure failure: '+note.reason);
}
