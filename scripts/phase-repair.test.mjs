import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRepairPhases,mergePhaseRepair} from './lib/phase-repair.mjs';
import {workloadContract} from './lib/workload-contract.mjs';
const workload={id:'test',sha256:'a',args:['1']};
const source={kind:'main',asOf:'2026-10-09',repository:'x/y',revision:'b',ref:'b',dateBasis:'commit'};
const fixture=()=>({capturedAt:'before',source,platform:{os:'linux',arch:'amd64',cpu:'CPU'},results:['compile','instantiate','first-call','steady'].map(phase=>({phase,version:'1',engine:'wasm3',workload:'test',artifactSha256:'a',contractSha256:workloadContract(workload),latencyStatus:phase==='steady'||phase==='instantiate'?'unsupported':'ok',timingSamples:phase==='steady'||phase==='instantiate'?0:5}))});
const job={source,repairPhases:['steady'],repairReason:'Proven fresh-state adapter fix'};
test('phase repair selects only missing observations and preserves every completed phase',()=>{
 const before=fixture(),snapshot=structuredClone(before);
 const selected=selectRepairPhases(before,workload,job);assert.deepEqual(selected,['steady']);
 const replacement={...before,capturedAt:'after',results:[{...before.results[3],latencyStatus:'ok',timingSamples:5,samplesNs:[1,1,1,1,1]}]};
 const merged=mergePhaseRepair(before,replacement,selected);
 assert.equal(merged.results[0],before.results[0]);assert.equal(merged.results[1],before.results[1]);assert.equal(merged.results[2],before.results[2]);assert.equal(merged.results[3].latencyStatus,'ok');assert.deepEqual(before,snapshot);
 assert.deepEqual(selectRepairPhases(merged,workload,job),[]);
});
test('source, platform, contracts and exact requested phase set are required',()=>{
 const before=fixture(),replacement={...before,results:[{...before.results[3]}]};
 assert.throws(()=>selectRepairPhases(before,{...workload,sha256:'changed'},job));
 assert.throws(()=>selectRepairPhases(before,workload,{...job,repairReason:''}));
 assert.throws(()=>selectRepairPhases(before,workload,{...job,repairPhases:['steady','steady']}));
 assert.throws(()=>mergePhaseRepair(before,{...replacement,source:{...source,revision:'changed'}},['steady']));
 assert.throws(()=>mergePhaseRepair(before,{...replacement,platform:{...before.platform,cpu:'other'}},['steady']));
 assert.throws(()=>mergePhaseRepair(before,{...replacement,results:[{...replacement.results[0],version:'other'}]},['steady']));
 assert.throws(()=>mergePhaseRepair(before,{...replacement,results:[before.results[0]]},['steady']));
 assert.throws(()=>mergePhaseRepair(before,{...replacement,results:[before.results[0]]},['compile']));
});
test('ordinary collection remains unchanged',()=>{
 assert.equal(selectRepairPhases(null,workload,{source}),null);
 assert.throws(()=>selectRepairPhases(null,workload,job));
});
