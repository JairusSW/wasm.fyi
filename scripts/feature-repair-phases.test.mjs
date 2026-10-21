import {test} from 'node:test';import assert from 'node:assert/strict';
import {featureRepairPhases} from './lib/feature-repair-phases.mjs';
const workload={id:'features/memory64/grow/16',features:['memory64']};
const input={engine:'wasmi',workload,prior:{outcomes:[['compile','unsupported'],['instantiate','failed'],['first-call','ok']]},repairEngines:['wasmi'],repairWorkloads:[workload.id],wasmiProposals:true};
test('explicit implemented proposal repair accepts unsupported without failure metadata, preserves OK',()=>assert.deepEqual(featureRepairPhases(input),['compile','instantiate']));
test('documented proposal repair can retry an explicitly selected unsupported phase',()=>assert.deepEqual(featureRepairPhases({...input,engine:'wasmtime',repairEngines:['wasmtime'],wasmiProposals:false,documentedProposals:true}),['compile','instantiate']));
test('unscoped unsupported repair stays failed-only',()=>assert.deepEqual(featureRepairPhases({...input,repairWorkloads:[]}),['instantiate']));
test('completed audited repairs are terminal across device slices',()=>{
 assert.deepEqual(featureRepairPhases({...input,prior:{...input.prior,status:'completed',repairOf:'older-capture.json'}}),[]);
 assert.deepEqual(featureRepairPhases({...input,prior:{...input.prior,status:'repair-pending',repairOf:'older-capture.json'}}),['compile','instantiate']);
});
test('source-bound reclassification is terminal without rerunning retained evidence',()=>assert.deepEqual(featureRepairPhases({...input,prior:{...input.prior,status:'completed',classifiedFrom:'raw.json'}}),[]));
test('an explicit adapter upgrade may retry a completed failed repair',()=>assert.deepEqual(featureRepairPhases({...input,prior:{...input.prior,status:'completed',repairOf:'older.json'},retryCompleted:true}),['compile','instantiate']));
test('the current repair policy is terminal across shared-device restarts',()=>{
 const repairPolicy='declared-feature-repair-v1';
 assert.deepEqual(featureRepairPhases({...input,prior:{...input.prior,status:'completed',repairOf:'older.json',repairPolicy},retryCompleted:true,repairPolicy}),[]);
 assert.deepEqual(featureRepairPhases({...input,prior:{...input.prior,status:'completed',repairOf:'older.json',repairPolicy:'older-policy'},retryCompleted:true,repairPolicy}),['compile','instantiate']);
});
test('a backend-binding repair reruns every recorded phase',()=>assert.deepEqual(featureRepairPhases({...input,forceAll:true}),['compile','instantiate','first-call']));
test('other engines and unrelated proposals never repair unsupported',()=>{
 assert.deepEqual(featureRepairPhases({...input,engine:'wasm3',repairEngines:['wasm3']}),['instantiate']);
 assert.deepEqual(featureRepairPhases({...input,workload:{...workload,features:['gc']}}),['instantiate']);
});

test('explicit relaxed SIMD uses the enabled SIMD implementation while preserving OK phases',()=>assert.deepEqual(featureRepairPhases({...input,workload:{...workload,features:['relaxed-simd']}}),['compile','instantiate']));
