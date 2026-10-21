import test from 'node:test';import assert from 'node:assert/strict';import {classifyFeatureCompilerRejection} from './lib/feature-unsupported.mjs';import {workloadContract} from './lib/workload-contract.mjs';
const revision='4a7f16c1154251fdc7b2de43b213c1043ad65d76',librarySha256='b'.repeat(64);
const workload={id:'features/tail-call/direct-recursion/1',sha256:'a'.repeat(64),abi:'core',features:['tail-call'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
const make=()=>({source:{revision,repository:'wasmerio/wasmer'},engine:'wasmer-cranelift',workload:structuredClone(workload),manifest:{lock:{workloads:[structuredClone(workload)],runtime_configurations:[{id:'wasmer-cranelift',file_sha256:{'/sdk/libwasmer.so':librarySha256},description:{backend:'cranelift-jit',effective_configuration:{native_sdk_receipt:JSON.stringify({revision,librarySha256})}}}]}},trials:[{id:'check-0-0',runtime_configuration:'wasmer-cranelift',workload:workload.id,status:'error',samples:null,reason:'error: compile: WebAssembly translation error: Unsupported feature: proposed tail-call operator ReturnCall { function_index: 0 }'}]});
test('actual proposed tail-call compiler rejection is source and artifact bound',()=>{assert.equal(classifyFeatureCompilerRejection(make()).status,'unsupported');const indirect=make();indirect.trials[0].reason='error: compile: WebAssembly translation error: Unsupported feature: proposed tail-call operator ReturnCallIndirect { type_index: 0, table_index: 0 }';assert.equal(classifyFeatureCompilerRejection(indirect).status,'unsupported')});
test('oracle, profile, trap and unbound compiler failures remain failures',()=>{
 for(const reason of ['error: incorrect result','error: unsupported host profile','error: trap: unreachable','error: compile: unsupported instruction']){const v=make();v.trials[0].reason=reason;assert.equal(classifyFeatureCompilerRejection(v),null)}
 for(const mutate of [v=>v.source.revision='c'.repeat(40),v=>v.workload.sha256='d'.repeat(64),v=>v.workload.oracle.expected=['1'],v=>v.manifest.lock.runtime_configurations[0].description.backend='singlepass-jit',v=>v.manifest.lock.runtime_configurations[0].file_sha256['/sdk/libwasmer.so']='e'.repeat(64),v=>v.trials[0].samples=[{verified:true}],v=>v.trials[0].workload='other']){const v=make();mutate(v);assert.equal(classifyFeatureCompilerRejection(v),null)}
});
import {classifyFeatureCapture,classifyFeatureRuntimeRejection} from './lib/feature-unsupported.mjs';
test('capture annotation changes failed zero-sample status only, preserves resources',()=>{
 const evidence=classifyFeatureCompilerRejection(make());
 const capture={capturedAt:'2026-10-10T00:00:00Z',platform:{memoryBytes:123},results:[{engine:'wasmer-cranelift',workload:workload.id,artifactSha256:workload.sha256,contractSha256:evidence.contractSha256,phase:'compile',latencyStatus:'failed',timingSamples:0,samplesNs:[],memoryStatus:'not-measured',codeStatus:'not-measured'}]};
 const after=classifyFeatureCapture(capture,evidence);assert.deepEqual(after,{...capture,results:[{...capture.results[0],latencyStatus:'unsupported'}]});assert.equal(capture.results[0].latencyStatus,'failed');
 const measured=structuredClone(capture);measured.results[0].samplesNs=[1];assert.equal(classifyFeatureCapture(measured,evidence),null);
 const mixed=structuredClone(capture);mixed.results[0].latencyStatus='ok';assert.equal(classifyFeatureCapture(mixed,evidence),null);
});

test('source-bound Wasmtime proposal rejection becomes unsupported',()=>{
 const featureWorkload={id:'features/memory-control/first-page/1',sha256:'c'.repeat(64),abi:'core',features:['memory-control'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
 const source={repository:'bytecodealliance/wasmtime',revision:'d'.repeat(40)};
 const contractSha256=workloadContract(featureWorkload);
 const capture={source,results:[{engine:'wasmtime',workload:featureWorkload.id,artifactSha256:featureWorkload.sha256,contractSha256,phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
 const failures=[{engine:'wasmtime',workload:featureWorkload.id,phase:'first-call',status:'error',reason:'error: failed to compile: memory control support is not enabled'}];
 const evidence=classifyFeatureRuntimeRejection({source,engine:'wasmtime',workload:featureWorkload,capture,failures});
 assert.equal(evidence.status,'unsupported');assert.equal(classifyFeatureCapture(capture,evidence).results[0].latencyStatus,'unsupported');
 for(const reason of ['error: trap: unreachable','error: incorrect result','error: unsupported instruction'])assert.equal(classifyFeatureRuntimeRejection({source,engine:'wasmtime',workload:featureWorkload,capture,failures:[{...failures[0],reason}]}),null);
});

test('Wasmtime sacrificial preflight and exact proposal encoding rejections remain source bound',()=>{
 const source={repository:'bytecodealliance/wasmtime',revision:'e'.repeat(40)};
 for(const [feature,engine,reason] of [
  ['half-precision','wasmtime','unknown 0xfd subopcode: 0x120'],
  ['stringref','wasmtime','unknown 0xfb subopcode: 0xa9'],
  ['acquire-release-atomics','wasmtime','atomic instructions must always specify maximum alignment'],
  ['custom-descriptors','wasmtime','custom descriptors proposal must be enabled'],
  ['shared-everything-threads','wasmtime','shared globals require the shared-everything-threads proposal'],
  ['reference-types','wasmtime-winch','Compilation error: Unsupported Wasm type'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'f'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const contractSha256=workloadContract(w),capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256,phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: ${reason}`}));
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature);
 }
});
