import assert from 'node:assert/strict';

// Bundle copies relocate artifact/input paths. Their hashes and every other
// contract field must match; relocation must never hide an oracle/input change.
export function assertRecoveryCohort(planned,original) {
 const normalize=workloads=>{
  const ids=new Set();
  return workloads.map(input=>{
   assert(!ids.has(input.id),'Duplicate recovery workload');ids.add(input.id);
   const workload=structuredClone(input);delete workload.artifact;
   for(const file of Object.values(workload.command?.files || {}))delete file.path;
   return workload;
  }).sort((a,b)=>a.id.localeCompare(b.id));
 };
 assert.deepEqual(normalize(planned),normalize(original),'Recovery workload contracts differ from timing');
}
