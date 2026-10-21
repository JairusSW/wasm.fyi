export function featureRepairPhases({engine,workload,prior,repairEngines,repairWorkloads,wasmiProposals=false,documentedProposals=false}) {
 if(!repairEngines.includes(engine)||!prior)return [];
 if(repairWorkloads.length&&!repairWorkloads.includes(workload.id))return [];
 const unsupported=documentedProposals||(wasmiProposals&&engine==='wasmi'&&repairWorkloads.includes(workload.id)&&workload.features?.some(f=>['memory64','simd','relaxed-simd'].includes(f)));
 return (prior.outcomes||[]).filter(([,status])=>status==='failed'||(unsupported&&status==='unsupported')).map(([phase])=>phase);
}
