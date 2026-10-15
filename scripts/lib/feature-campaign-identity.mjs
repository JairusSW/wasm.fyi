import {cpus,totalmem} from 'node:os';
import {execFileSync} from 'node:child_process';
import {digest} from './wasmbench.mjs';
import {workloadContract} from './workload-contract.mjs';

export function featureCampaignPlatform(template){
 return {os:process.platform,arch:process.arch==='x64'?'amd64':'arm64',cpu:cpus()[0].model,cores:template.platformSpecs?.cores||cpus().length,kernel:execFileSync('uname',['-srv']).toString().trim(),memoryBytes:template.platformSpecs?.memoryBytes||totalmem()};
}
export function featureInputIdentity(suites){
 return digest(Buffer.from(JSON.stringify(Object.entries(suites).map(([kind,list])=>[kind,list.map(w=>[w.id,w.sha256,workloadContract(w)])]))));
}
export function featureLedgerKey(hostKey,engine,source,kind,workload,inputIdentity){
 const key=[hostKey,engine,source.revision,source.asOf,kind,workload.id,workload.sha256,workloadContract(workload),inputIdentity];
 // Old ledgers incorrectly requested first-call for these non-executable probes.
 if(kind==='compatibility'&&['compile-only','compile-and-instantiate'].includes(workload.provenance?.scope))key.push('scope-aware-v2',workload.provenance.scope);
 return digest(Buffer.from(JSON.stringify(key)));
}
