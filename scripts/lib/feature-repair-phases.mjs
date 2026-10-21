export function featureRepairPhases({engine,workload,prior,repairEngines,repairWorkloads,wasmiProposals=false,documentedProposals=false,retryCompleted=false,forceAll=false,repairPolicy}) {
 if(!repairEngines.includes(engine)||!prior)return [];
 if(repairWorkloads.length&&!repairWorkloads.includes(workload.id))return [];
 // A repair policy is resumable across process and shared-device slices. A
 // completed row carrying the current receipt has already been reconsidered
 // by this adapter policy, including terminal unsupported/failure outcomes.
 // Older repairs without the receipt are still eligible for one migration.
 if(repairPolicy&&prior.repairPolicy===repairPolicy&&prior.status==='completed')return [];
 // A repair that produced a complete capture is an audited terminal outcome,
 // even when that outcome is a genuine engine failure or bounded timeout.
 // Retrying it after every shared-device slice can prevent later engines from
 // ever running. Integration defects remain `repair-pending` and retryable.
 if(prior.repairOf&&prior.status==='completed'&&!retryCompleted)return [];
 if(prior.classifiedFrom&&prior.status==='completed')return [];
 if(forceAll)return (prior.outcomes||[]).map(([phase])=>phase);
 const unsupported=documentedProposals||(wasmiProposals&&engine==='wasmi'&&repairWorkloads.includes(workload.id)&&workload.features?.some(f=>['memory64','simd','relaxed-simd'].includes(f)));
 return (prior.outcomes||[]).filter(([,status])=>status==='failed'||(unsupported&&status==='unsupported')).map(([phase])=>phase);
}
