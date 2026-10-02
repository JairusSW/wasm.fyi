import {digest} from './wasmbench.mjs';

// A Wednesday is an index into a measured release, not its collection date.
// Identical releases share work only within the same complete measurement recipe.
export function performanceHistoryQueue(plan,{host,corpusSha256,recipeSha256,options}) {
  if(!host || !/^[a-f0-9]{64}$/.test(corpusSha256) || !/^[a-f0-9]{64}$/.test(recipeSha256))throw Error('Performance history requires host, corpus and recipe identities');
  const jobs=new Map(),snapshots=[];
  const seen=new Set();
  for(const pin of plan.pins) {
    const key=pin.engine+'/'+pin.targetWeek;
    if(seen.has(key))throw Error('Duplicate engine/Wednesday: '+key);
    seen.add(key);
    if(pin.status!=='planned') {
      snapshots.push({...pin,status:'unavailable',reason:pin.reason || 'No published release at the Wednesday cutoff.'});
      continue;
    }
    if(!pin.tag || !pin.repository || !Number.isFinite(+new Date(pin.publishedAt)) || !Number.isFinite(+new Date(pin.targetWeek)) || !pin.configurations?.length || +new Date(pin.publishedAt)>+new Date(pin.targetWeek))throw Error('Invalid released-engine history pin: '+key);
    const identity={engine:pin.engine,repository:pin.repository,tag:pin.tag,publishedAt:pin.publishedAt,prerelease:!!pin.prerelease,embeddedV8:pin.embeddedV8 || null,
      host,corpusSha256,recipeSha256,configurations:pin.configurations,options};
    const jobId=digest(JSON.stringify(identity));
    const job=jobs.get(jobId) || {id:jobId,identity,release:pin,targetWeeks:[],status:'pending'};
    job.targetWeeks.push(pin.targetWeek);jobs.set(jobId,job);
    snapshots.push({...pin,jobId,status:'pending'});
  }
  const ordered=[...jobs.values()].sort((a,b)=>b.targetWeeks.at(-1).localeCompare(a.targetWeeks.at(-1)));
  return {schema:1,host,corpusSha256,recipeSha256,options,jobs:ordered,snapshots};
}

// Include the full oracle/ABI/reset metadata, not just artifact bytes. Sorting
// makes identity independent of presentation order, but duplicate IDs are errors.
export function performanceCorpusIdentity(workloads) {
  const seen=new Set();
  const contracts=workloads.map(w=>{
    if(seen.has(w.id))throw Error('Duplicate history workload: '+w.id);seen.add(w.id);
    if(!/^[a-f0-9]{64}$/.test(w.sha256))throw Error('History workload needs a digest: '+w.id);
    const {artifact,...contract}=w;
    return contract;
  }).sort((a,b)=>a.id.localeCompare(b.id));
  return digest(JSON.stringify(contracts));
}
