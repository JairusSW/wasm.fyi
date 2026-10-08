import { workloadCategory, compareWorkloads } from './workload-category.mjs';

/** Historical labels and weights come from the recorded contract, never a rebuild. */
export function historicalWorkload(workload) {
 return {id:workload.id,artifactSha256:workload.sha256,group:workloadCategory(workload),abi:workload.abi};
}

/** Reference IDs and hashes come only from the pinned historical baseline. */
export function historicalReference(baselineWorkloads,projectSnapshots) {
 const catalogue=baselineWorkloads.map(historicalWorkload).sort(compareWorkloads);
 return {catalogue,referenceCells:projectSnapshots(catalogue).s1,
  workloads:baselineWorkloads.map(w=>w.id),artifactSha256:Object.fromEntries(baselineWorkloads.map(w=>[w.id,w.sha256]))};
}
