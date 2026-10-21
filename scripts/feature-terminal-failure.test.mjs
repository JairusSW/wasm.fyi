import test from 'node:test';import assert from 'node:assert/strict';
import {terminalFeatureRuntimeFailure} from './lib/feature-terminal-failure.mjs';
const engine='wasm3',workload='features/custom-page-sizes/case/1',reason='adapter terminated before response (see trial log)';
const note={kind:'failed-trials',engine,workload,failures:[{engine,workload,status:'preflight_failed',reason:'sacrificial check check-0-0: '+reason},{engine,workload,status:'error',reason}]};
test('qualified engine workload crashes remain terminal failed feature outcomes',()=>{
 assert.equal(terminalFeatureRuntimeFailure(note,{engineQualified:true}),true);
 assert.equal(terminalFeatureRuntimeFailure(note,{engineQualified:false}),false);
});
test('startup, transport, mismatched and partial failures remain repair pending',()=>{
 for(const changed of [
  {...note,workload:'applications/case/1'},
  {...note,failures:[note.failures[1]]},
  {...note,failures:note.failures.map(f=>({...f,reason:'adapter startup failed'}))},
  {...note,failures:note.failures.map((f,i)=>i?{...f,workload:'features/other/case/1'}:f)},
 ])assert.equal(terminalFeatureRuntimeFailure(changed,{engineQualified:true}),false);
});
