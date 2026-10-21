export function featureRepairPhases({engine,workload,prior,repairEngines,repairWorkloads,wasmiProposals=false,documentedProposals=false}) {
 if(!repairEngines.includes(engine)||!prior)return [];
 if(repairWorkloads.length&&!repairWorkloads.includes(workload.id))return [];
 // A repair that produced a complete capture is an audited terminal outcome,
 // even when that outcome is a genuine engine failure or bounded timeout.
 // Retrying it after every shared-device slice can prevent later engines from
 // ever running. Integration defects remain `repair-pending` and retryable.
 if(prior.repairOf&&prior.status==='completed')return [];
 const unsupported=documentedProposals||(wasmiProposals&&engine==='wasmi'&&repairWorkloads.includes(workload.id)&&workload.features?.some(f=>['memory64','simd','relaxed-simd'].includes(f)));
 return (prior.outcomes||[]).filter(([,status])=>status==='failed'||(unsupported&&status==='unsupported')).map(([phase])=>phase);
}
