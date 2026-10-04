import {digest} from './wasmbench.mjs';

// Weekly default-branch and release snapshots share work only for identical
// source identities and complete measurement recipes.
export function performanceHistoryQueue(plan,{host,corpusSha256,recipeSha256,options}) {
  if(!host || !/^[a-f0-9]{64}$/.test(corpusSha256) || !/^[a-f0-9]{64}$/.test(recipeSha256))throw Error('Performance history requires host, corpus and recipe identities');
  const jobs=new Map(),snapshots=[];
  const seen=new Set();
  for(const pin of [...(plan.pins||[]),...(plan.releasePins||[])]) {
    const targetType=pin.targetType||'weekly';
    const key=pin.engine+'/'+targetType+'/'+(targetType==='release'?pin.targetRelease:pin.targetWeek);
    if(seen.has(key))throw Error('Duplicate engine/Saturday: '+key);
    seen.add(key);
    if(pin.status!=='planned') {
      snapshots.push({...pin,status:'unavailable',reason:pin.reason || 'No published release at the Saturday cutoff.'});
      continue;
    }
    if(!pin.repository || !Number.isFinite(+new Date(pin.targetWeek)) || !pin.configurations?.length)throw Error('Invalid engine history pin: '+key);
    if(targetType==='main'&&(!pin.branch||!/^([a-f0-9]{40}|[a-f0-9]{64})$/i.test(pin.revision)))throw Error('Invalid default-branch history pin: '+key);
    if(targetType!=='main'&&(!pin.tag || !Number.isFinite(+new Date(pin.publishedAt)) || +new Date(pin.publishedAt)>+new Date(pin.targetWeek)))throw Error('Invalid released-engine history pin: '+key);
    const identity={engine:pin.engine,repository:pin.repository,tag:pin.tag,publishedAt:pin.publishedAt,prerelease:!!pin.prerelease,embeddedV8:pin.embeddedV8 || null,
      branch:pin.branch||null,revision:pin.revision||null,host,corpusSha256,recipeSha256,configurations:pin.configurations,options};
    const jobId=digest(JSON.stringify(identity));
    const job=jobs.get(jobId) || {id:jobId,identity,source:pin,release:pin,targetWeeks:[],targetReleases:[],status:'pending'};
    if(targetType==='release')job.targetReleases.push({tag:pin.targetRelease,publishedAt:pin.publishedAt});
    else job.targetWeeks.push(pin.targetWeek);
    jobs.set(jobId,job);
    snapshots.push({...pin,jobId,status:'pending'});
  }
  const latest=job=>[...job.targetWeeks,...job.targetReleases.map(r=>r.publishedAt)].sort().at(-1)||'';
  const ordered=[...jobs.values()].sort((a,b)=>latest(b).localeCompare(latest(a)));
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
