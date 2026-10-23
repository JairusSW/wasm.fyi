import test from 'node:test';
import assert from 'node:assert/strict';
import {featureInputIdentity,featureLedgerKey} from './lib/feature-campaign-identity.mjs';
import {migrateFeatureLedger} from './lib/feature-ledger-migration.mjs';
import {workloadContract} from './lib/workload-contract.mjs';

const workload=(id,sha='a'.repeat(64),expected='1')=>({id,sha256:sha,artifact:'artifacts/'+sha+'.wasm',abi:'core',export:'benchmark',args:[1],oracle:{kind:'exact_u64',expected:[expected]},reset:'stateless'});
test('input migration reuses only completed byte-identical contracts',()=>{
 const pin={revision:'rev',asOf:'week',configurations:['engine']},hostKey='host';
 const retained=workload('features/mvp/retained'),changed=workload('features/mvp/changed'),replacement=workload(changed.id,'b'.repeat(64));
 const oldSuites={compatibility:[retained,changed],performance:[],compile:[],lifecycle:[]};
 const newSuites={compatibility:[retained,replacement],performance:[],compile:[],lifecycle:[]};
 const oldIdentity=featureInputIdentity(oldSuites),retainedKey=featureLedgerKey(hostKey,'engine',pin,'compatibility',retained,oldIdentity),changedKey=featureLedgerKey(hostKey,'engine',pin,'compatibility',changed,oldIdentity);
 const item=(row,capture)=>({status:'completed',engine:'engine',stage:'compatibility',workload:row.id,source:pin,artifactSha256:row.sha256,contractSha256:workloadContract(row),capture});
 const ledger={items:{[retainedKey]:item(retained,'retained.json'),[changedKey]:item(changed,'changed.json')},completedEngines:['engine|rev|'+oldIdentity]};
 const result=migrateFeatureLedger({ledger,oldSuites,newSuites,hostKey});
 const newKey=featureLedgerKey(hostKey,'engine',pin,'compatibility',retained,result.summary.newInputIdentity);
 assert.equal(result.summary.migrated,1);assert.equal(result.summary.changed,1);assert.equal(result.summary.unrelated,0);
 assert.equal(result.ledger.items[newKey].capture,'retained.json');assert.equal(result.ledger.items[newKey].migratedFrom,retainedKey);
 assert.deepEqual(result.ledger.completedEngines,ledger.completedEngines);
 assert.equal(Object.values(result.ledger.items).some(item=>item.capture==='changed.json'&&item.inputIdentity===result.summary.newInputIdentity),false);
});

test('input migration does not promote incomplete retained work',()=>{
 const pin={revision:'rev',asOf:'week',configurations:['engine']},hostKey='host',row=workload('features/mvp/a');
 const oldSuites={compatibility:[row],performance:[],compile:[],lifecycle:[]},newSuites={compatibility:[row],performance:[],compile:[],lifecycle:[workload('features/mvp/new')]};
 const oldKey=featureLedgerKey(hostKey,'engine',pin,'compatibility',row,featureInputIdentity(oldSuites));
 const result=migrateFeatureLedger({ledger:{items:{[oldKey]:{status:'repair-pending',engine:'engine',stage:'compatibility',workload:row.id,source:pin,artifactSha256:row.sha256,contractSha256:workloadContract(row)}},completedEngines:[]},oldSuites,newSuites,hostKey});
 assert.equal(result.summary.migrated,0);assert.equal(result.summary.incomplete,1);assert.equal(result.summary.changed,0);
});
