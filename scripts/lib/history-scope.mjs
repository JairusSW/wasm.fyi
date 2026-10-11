import {workloadContract} from './workload-contract.mjs';
export const excludedHistoryEngines=new Set(['deno','wasm2js','wasm2rs']);
export const historyEngineOrder=['wago','wasmtime','wasmer','wazero','v8','wavm','spidermonkey','jsc','wasmi','wamr','wasm3','wasmedge','chicory','wasm2go','wasm2c','w2c2','libwasm','wazy','chasm','wizard','graalwasm','zwasm','endive'];
export function validateHistoricalScope(plan,workloads){
 const historical=(plan.jobs||[]).filter(job=>job.historical);
 if(!historical.length)return;
 const cutoff=Date.parse(plan.cutoff),anchor=Date.parse(plan.anchor);
 if(!Number.isFinite(cutoff)||!Number.isFinite(anchor)||cutoff>anchor)throw Error('Historical collection requires a valid frozen time window');
 for(const job of historical){
  const target=Date.parse(job.source?.asOf);
  if(!Number.isFinite(target)||target<cutoff||target>anchor)throw Error('Historical source outside requested window');
 }
 if(workloads.some(w=>w.id.startsWith('features/')))throw Error('Historical collection excludes feature corpora; features run only on latest versions');
}
export function nearestCommitSearchUntil(prior,target,{cutoff,anchor,sourceCutoff=cutoff}) {
 const time=Date.parse(target),start=Date.parse(sourceCutoff),end=Date.parse(anchor);
 if(![time,start,end].every(Number.isFinite)||start>end||time>end)throw Error('Invalid nearest-commit search bounds');
 const before=Date.parse(prior?.commit?.committer?.date||prior?.commit?.author?.date);
 if(!Number.isFinite(before)||before<start||before>time)return new Date(time).toISOString();
 return new Date(Math.min(end,time+Math.abs(time-before)+1000)).toISOString();
}
export function nearestCommit(commits,target,{cutoff,anchor,sourceCutoff=cutoff}) {
 const time=Date.parse(target),start=Date.parse(sourceCutoff),end=Date.parse(anchor);
 const eligible=commits.filter(c=>/^[a-f0-9]{40}$/i.test(c.sha)&&Date.parse(c.commit?.committer?.date||c.commit?.author?.date)>=start&&Date.parse(c.commit?.committer?.date||c.commit?.author?.date)<=end);
 if(!eligible.some(c=>Date.parse(c.commit?.committer?.date||c.commit?.author?.date)<=time))return undefined;
 return eligible.sort((a,b)=>{const at=Date.parse(a.commit?.committer?.date||a.commit?.author?.date),bt=Date.parse(b.commit?.committer?.date||b.commit?.author?.date);return Math.abs(at-time)-Math.abs(bt-time)||at-bt})[0];
}
export function everyVersion(releases,cutoff,anchor){return releases.filter(r=>!r.draft&&r.tag_name&&Date.parse(r.published_at)>=Date.parse(cutoff)&&Date.parse(r.published_at)<=Date.parse(anchor)).sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at));}
function matchesSampling(row,policy){
 if(!policy||row.latencyStatus!=='ok')return true;
 const metadata=row.sampling;
 return metadata?.method==='same-process-stability-v1'&&metadata.groupSize===5&&(metadata.maxSamples===35||metadata.maxSamples===(['compile','instantiate'].includes(row.phase)?10:25))&&metadata.warmup===0&&row.timingSamples>=5&&row.timingSamples<=metadata.maxSamples&&row.timingSamples%5===0&&Array.isArray(row.samplesNs)&&row.samplesNs.length===row.timingSamples;
}
export function reusableCapture(capture,workload,source,samples,policy){return !!capture&&capture.source?.asOf===source.asOf&&capture.source?.repository===source.repository&&capture.source?.kind===source.kind&&capture.source?.ref===source.ref&&capture.source?.dateBasis===source.dateBasis&&(source.kind==='current'||capture.source?.revision===source.revision)&&capture.results?.length===4&&['compile','instantiate','first-call','steady'].every(phase=>capture.results.some(r=>r.phase===phase&&r.version!=='unknown'&&r.artifactSha256===workload.sha256&&r.contractSha256===workloadContract(workload)&&matchesSampling(r,policy)&&(r.latencyStatus!=='ok'||r.timingSamples>=samples)));}
