import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {reconcileFeatureClassifications} from './reconcile-feature-classifications.mjs';
import {workloadContract} from './lib/workload-contract.mjs';

test('newer raw source rejection is reclassified after an older classification',async()=>{
 const root=await mkdtemp(join(tmpdir(),'feature-reconcile-')),ledgerDirectory=join(root,'latest'),inputs=join(root,'inputs');await mkdir(join(root,'captures'));await mkdir(join(root,'failure-notes'));await mkdir(join(ledgerDirectory,'captures'),{recursive:true});await mkdir(inputs);
 const artifact=Buffer.from([0,97,115,109,1,0,0,0]),sha256=createHash('sha256').update(artifact).digest('hex');
 const workload={id:'features/shared-everything-threads/probe/1',artifact:'probe.wasm',sha256,abi:'core',features:['shared-everything-threads'],export:'benchmark',args:[1],reset:'stateless',oracle:{kind:'exact_u64',expected:[1]}};
 for(const stage of ['compatibility','performance','compile','lifecycle'])await writeFile(join(inputs,stage+'.json'),JSON.stringify(stage==='compatibility'?[workload]:[]));
 const source={repository:'bytecodealliance/wasmtime',revision:'a'.repeat(40),asOf:'2026-10-15T00:00:00Z'},engine='wasmtime',key='b'.repeat(64),contractSha256=workloadContract(workload);
 const row=status=>({engine,workload:workload.id,artifactSha256:sha256,contractSha256,phase:'first-call',latencyStatus:status,timingSamples:0});
 const old='feature-classified-wasmtime-'+key+'.json',raw='feature-compat-wasmtime-'+key+'.json';
 await writeFile(join(root,'captures',old),JSON.stringify({capturedAt:'2026-10-20T00:00:00Z',source,results:[row('unsupported')]}));
 await writeFile(join(root,'captures',raw),JSON.stringify({capturedAt:'2026-10-21T00:00:00Z',source,results:[row('failed')]}));
 await writeFile(join(root,'failure-notes',raw),JSON.stringify({kind:'failed-trials',failures:[{engine,workload:workload.id,phase:'first-call',status:'error',reason:'error: shared composite types require the shared-everything-threads proposal'}]}));
 await writeFile(join(ledgerDirectory,'ledger.json'),JSON.stringify({items:{[key]:{status:'completed',engine,stage:'compatibility',workload:workload.id,source,capture:old,artifactSha256:sha256,contractSha256,outcomes:[['first-call','unsupported']]}}}));
 const result=await reconcileFeatureClassifications({campaign:root,ledgerDirectory,inputs,write:true,clock:()=>new Date('2026-10-22T00:00:00Z')});
 assert.deepEqual({reclassified:result.reclassified,updatedFailures:result.updatedFailures,unresolved:result.unresolved},{reclassified:1,updatedFailures:0,unresolved:[]});
 const ledger=JSON.parse(await readFile(join(ledgerDirectory,'ledger.json')));assert.equal(ledger.items[key].outcomes[0][1],'unsupported');assert.equal(ledger.items[key].classifiedFrom,raw);assert.deepEqual(ledger.items[key].classifiedSources,[raw]);
 const replay=JSON.parse(await readFile(join(root,'captures',ledger.items[key].capture)));assert.equal(replay.capturedAt,'2026-10-22T00:00:00.000Z');assert.equal(replay.results[0].latencyStatus,'unsupported');
});

test('later infrastructure capture cannot supersede completed runtime evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'feature-reconcile-infra-')),ledgerDirectory=join(root,'latest'),inputs=join(root,'inputs');await mkdir(join(root,'captures'));await mkdir(join(root,'failure-notes'));await mkdir(join(ledgerDirectory,'captures'),{recursive:true});await mkdir(inputs);
 const sha256='1'.repeat(64),workload={id:'features/core-num/probe/1',artifact:'probe.wasm',sha256,abi:'core',features:['core-num'],export:'benchmark',args:[1],reset:'stateless',oracle:{kind:'exact_u64',expected:[1]}},contractSha256=workloadContract(workload);
 for(const stage of ['compatibility','performance','compile','lifecycle'])await writeFile(join(inputs,stage+'.json'),JSON.stringify(stage==='compatibility'?[workload]:[]));
 const source={repository:'fixture/runtime',revision:'a'.repeat(40),asOf:'2026-10-15T00:00:00Z'},engine='fixture',key='c'.repeat(64),row=status=>({engine,workload:workload.id,artifactSha256:sha256,contractSha256,phase:'first-call',latencyStatus:status,timingSamples:status==='ok'?1:0,samplesNs:status==='ok'?[1]:[]});
 const good='feature-compat-fixture-'+key+'.json',retry=good;
 await writeFile(join(ledgerDirectory,'captures',good),JSON.stringify({capturedAt:'2026-10-20T00:00:00Z',source,results:[row('ok')]}));await writeFile(join(root,'captures',retry),JSON.stringify({capturedAt:'2026-10-21T00:00:00Z',source,results:[row('failed')]}));
 await writeFile(join(root,'failure-notes',retry),JSON.stringify({capturedAt:'2026-10-21T00:00:00Z',kind:'capture-error',reason:'Error: Capture infrastructure failure: adapter stopped'}));
 await writeFile(join(ledgerDirectory,'ledger.json'),JSON.stringify({items:{[key]:{status:'completed',engine,stage:'compatibility',workload:workload.id,source,capture:good,artifactSha256:sha256,contractSha256,outcomes:[['first-call','ok']]}}}));
 const result=await reconcileFeatureClassifications({campaign:root,ledgerDirectory,inputs,write:true,clock:()=>new Date('2026-10-22T00:00:00Z')});assert.equal(result.ignoredIntegration,1);assert.equal(result.reclassified,0);assert.equal(result.updatedFailures,1);assert.equal(result.reaffirmed,1);
 const ledger=JSON.parse(await readFile(join(ledgerDirectory,'ledger.json')));assert.notEqual(ledger.items[key].capture,good);assert.deepEqual(ledger.items[key].outcomes,[['first-call','ok']]);
 const replay=JSON.parse(await readFile(join(root,'captures',ledger.items[key].capture)));assert.equal(replay.capturedAt,'2026-10-22T00:00:00.000Z');assert.equal(replay.results[0].latencyStatus,'ok');
});

test('selected replay reuses its embedded ledger failure for later classification',async()=>{
 const root=await mkdtemp(join(tmpdir(),'feature-reconcile-ledger-note-')),ledgerDirectory=join(root,'latest'),inputs=join(root,'inputs');await mkdir(join(root,'captures'));await mkdir(join(root,'failure-notes'));await mkdir(join(ledgerDirectory,'captures'),{recursive:true});await mkdir(inputs);
 const sha256='2'.repeat(64),workload={id:'features/threads/ordinary-load-store/1',artifact:'probe.wasm',sha256,abi:'core',features:['threads'],export:'benchmark',args:[1],reset:'stateless',oracle:{kind:'exact_u64',expected:[1]}},contractSha256=workloadContract(workload);
 for(const stage of ['compatibility','performance','compile','lifecycle'])await writeFile(join(inputs,stage+'.json'),JSON.stringify(stage==='compatibility'?[workload]:[]));
 const source={repository:'wago-org/wago',revision:'a3c9d5b2097640899eb37cd5cc68b7bfc348de47',asOf:'2026-10-09T00:00:00Z'},engine='wago',key='d'.repeat(64),capture='feature-replay-wago-'+key+'.json';
 const failure={kind:'reconciled-latest-failures',failures:[{engine,workload:workload.id,phase:'first-call',status:'error',reason:'error: compile: threads currently require shared memory to be imported'}]};
 await writeFile(join(root,'captures',capture),JSON.stringify({capturedAt:'2026-10-21T00:00:00Z',source,results:[{engine,workload:workload.id,artifactSha256:sha256,contractSha256,phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]}));
 await writeFile(join(root,'failure-notes',capture),JSON.stringify({kind:'failed-trials',failures:[{engine,workload:workload.id,phase:'first-call',status:'error',reason:'adapter terminated before response'}]}));
 await writeFile(join(ledgerDirectory,'ledger.json'),JSON.stringify({items:{[key]:{status:'completed',engine,stage:'compatibility',workload:workload.id,source,capture,artifactSha256:sha256,contractSha256,outcomes:[['first-call','failed']],failure}}}));
 const result=await reconcileFeatureClassifications({campaign:root,ledgerDirectory,inputs,write:true,clock:()=>new Date('2026-10-22T00:00:00Z')});assert.equal(result.reclassified,1);
 const ledger=JSON.parse(await readFile(join(ledgerDirectory,'ledger.json')));assert.deepEqual(ledger.items[key].outcomes,[['first-call','unsupported']]);assert.equal(ledger.items[key].failure,undefined);
});
