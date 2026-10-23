import {featureInputIdentity,featureLedgerKey} from './feature-campaign-identity.mjs';
import {workloadContract} from './workload-contract.mjs';

const workloadIdentity=workload=>JSON.stringify([workload.id,workload.sha256,workloadContract(workload)]);

/** Re-key completed, byte-identical contracts when a frozen input set changes. */
export function migrateFeatureLedger({ledger,oldSuites,newSuites,hostKey}) {
 const oldInputIdentity=featureInputIdentity(oldSuites),newInputIdentity=featureInputIdentity(newSuites);
 if(oldInputIdentity===newInputIdentity)throw Error('Feature input identity did not change');
 const oldByKind=Object.fromEntries(Object.entries(oldSuites).map(([kind,rows])=>[kind,new Map(rows.map(row=>[workloadIdentity(row),row]))]));
 const newByKind=Object.fromEntries(Object.entries(newSuites).map(([kind,rows])=>[kind,new Map(rows.map(row=>[workloadIdentity(row),row]))]));
 const newIDs=Object.fromEntries(Object.entries(newSuites).map(([kind,rows])=>[kind,new Set(rows.map(row=>row.id))]));
 const items={...ledger.items};let migrated=0,changed=0,removed=0,unrelated=0,incomplete=0;
 for(const [oldKey,prior] of Object.entries(ledger.items)){
  if(prior?.status!=='completed'){incomplete++;continue}
  if(!prior.source){unrelated++;continue}
  const kind=prior.stage,identity=JSON.stringify([prior.workload,prior.artifactSha256,prior.contractSha256]);
  const oldWorkload=oldByKind[kind]?.get(identity);
  if(!oldWorkload||featureLedgerKey(hostKey,prior.engine,prior.source,kind,oldWorkload,oldInputIdentity)!==oldKey){unrelated++;continue}
  const workload=newByKind[kind]?.get(identity);
  if(!workload){if(newIDs[kind]?.has(prior.workload))changed++;else removed++;continue}
  const newKey=featureLedgerKey(hostKey,prior.engine,prior.source,kind,workload,newInputIdentity);
  if(items[newKey]?.status==='completed')continue;
  items[newKey]={...prior,migratedFrom:oldKey,inputIdentity:newInputIdentity};migrated++;
 }
 return {ledger:{...ledger,items},summary:{oldInputIdentity,newInputIdentity,migrated,changed,removed,unrelated,incomplete}};
}
