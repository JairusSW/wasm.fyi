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
  ['acquire-release-atomics','wasmtime-winch','threads must be enabled for shared memories'],
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

test('Wasmer compact-import validation rejection remains source and artifact bound',()=>{
 const source={repository:'wasmerio/wasmer',revision:'f'.repeat(40)};
 for(const engine of ['wasmer-singlepass','wasmer-cranelift','wasmer-llvm']){
  for(const [feature,reason] of [
   ['compact-imports','invalid leading byte 0x7F with compact imports proposal disabled'],
   ['custom-page-sizes',"the custom page sizes proposal must be enabled to customize a memory's page size"],
   ['half-precision','unknown 0xfd subopcode: 0x120'],
   ['stringref','unknown 0xfb subopcode: 0xa9'],
   ['acquire-release-atomics','atomic instructions must always specify maximum alignment'],
   ['memory-control','memory control support is not enabled'],
   ['shared-everything-threads','shared globals require the shared-everything-threads proposal'],
   ['legacy-exceptions','legacy_exceptions feature required for try instruction'],
  ]){
   const w={id:`features/${feature}/case/1`,sha256:'a'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
   const contractSha256=workloadContract(w),capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256,phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
   const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: compile: Validation error: ${reason} (at offset 0x1e)`}));
   const evidence=classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures});
   assert.equal(evidence?.status,'unsupported',`${engine} ${feature}`);
   const wrong=structuredClone(failures);wrong[1].reason='error: trap: unreachable';
   assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures:wrong}),null);
  }
 }
});

test('Wazero proposal encodings absent from its public feature API are source bound',()=>{
 const source={repository:'tetratelabs/wazero',revision:'1'.repeat(40)};
 for(const engine of ['wazero','wazero-interpreter'])for(const [feature,reason] of [
  ['wide-arithmetic','unknown misc opcode 0x13'],
  ['wide-arithmetic','unknown misc opcode 0x14'],
  ['wide-arithmetic','unknown misc opcode 0x15'],
  ['wide-arithmetic','unknown misc opcode 0x16'],
  ['compact-imports','import[0] 0x7f[wasmbench.]: invalid byte: invalid byte for importdesc: 0x7f'],
  ['custom-page-sizes','section memory: invalid byte for limits: 0x9 not in (0x00, 0x01, 0x02, 0x03)'],
  ['memory-control','unknown misc opcode 0x12'],
  ['half-precision','cannot pop the operand for i32x4.abs: type mismatch: expected v128, but was f32'],
  ['stringref','invalid instruction 0xfb'],
  ['acquire-release-atomics','invalid memory alignment'],
  ['shared-everything-threads','global[0]: invalid byte for mutability: 0x3 != 0x00 or 0x01'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'2'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const contractSha256=workloadContract(w),capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256,phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: ${reason}`}));
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',`${engine} ${feature}`);
  const trap=structuredClone(failures);trap[1].reason='error: wasm error: unreachable';
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures:trap}),null);
 }
});

test('Wazero typed-function-reference runtime traps remain failures',()=>{
 const source={repository:'tetratelabs/wazero',revision:'3'.repeat(40)},engine='wazero';
 const w={id:'features/typed-function-references/selected-target/1',sha256:'4'.repeat(64),abi:'core',features:['typed-function-references'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
 const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
 const failures=[{engine,workload:w.id,phase:'first-call',status:'error',reason:'error: wasm error: unreachable'}];
 assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures}),null);
});

test('V8 exact flagged proposal gaps are source and artifact bound',()=>{
 const source={repository:'nodejs/node',revision:'5'.repeat(40)},engine='v8';
 for(const [feature,reason] of [
  ['custom-page-sizes','WebAssembly.Module(): invalid memory limits flags 0x9 @+23'],
  ['acquire-release-atomics','WebAssembly.Module(): invalid alignment; expected maximum alignment is 2, actual alignment is 34 @+82'],
  ['shared-everything-threads','WebAssembly.Module(): Compiling function #0 failed: invalid atomic opcode: 0xfe5f @+74'],
  ['shared-everything-threads','WebAssembly.Module(): Compiling function #0 failed: invalid atomic opcode: 0xfe50 @+65'],
  ['memory-control','WebAssembly.Module(): Compiling function #0 failed: invalid numeric opcode: 0xfc12 @+77'],
  ['custom-descriptors','WebAssembly.Module(): Compiling function #3 failed: invalid gc opcode: fb20 @+189'],
  ['custom-descriptors','WebAssembly.Module(): Compiling function #3 failed: invalid gc opcode: fb21 @+187'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'6'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: ${reason}`}));
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature);
 }
});

test('WAVM exact source decoder gaps are source and artifact bound',()=>{
 const source={repository:'WAVM/WAVM',revision:'7'.repeat(40)},engine='wavm';
 for(const [feature,reason] of [
  ['gc','Module was malformed: unknown function type tag (95)'],
  ['exceptions','Module was malformed: unknown section ID (13'],
  ['tail-call','Module was malformed: unknown opcode (18)'],
  ['compact-imports','Module was malformed: invalid value type encoding'],
  ['relaxed-simd','Module was malformed: unknown opcode (253 256)'],
  ['typed-function-references','Module was malformed: invalid reference type encoding'],
  ['custom-page-sizes','Module was malformed: unknown memory type flag'],
  ['shared-everything-threads','Module was malformed: unknown function type tag (101)'],
  ['stack-switching','Module was malformed: unknown function type tag (93)'],
  ['memory-control','Module was malformed: unknown opcode (64530)'],
  ['half-precision','Module was malformed: unknown opcode (253 288)'],
  ['stringref','Module was malformed: unknown opcode (64425)'],
  ['acquire-release-atomics','Module was invalid: shared memory requires atomics feature'],
  ['custom-descriptors','Module was malformed: unknown function type tag (78)'],
  ['wide-arithmetic','Module was malformed: unknown opcode (64531)'],
  ['extended-const','Module was malformed: expected end opcode: loaded 65 but was expecting 11'],
  ['extended-name-section','Module was malformed: unknown function type tag (95)'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'8'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: module compilation failed: ${reason}`}));
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature);
 }
});

test('SpiderMonkey ESR exact decoder gaps are source and artifact bound',()=>{
 const source={repository:'mozilla-firefox/firefox',revision:'9'.repeat(40)},engine='spidermonkey';
 for(const [feature,reason] of [
  ['gc','Structure types not enabled'],
  ['gc','gc types not enabled'],
  ['gc','unrecognized opcode: fb 1c'],
  ['compact-imports','unsupported import kind'],
  ['wide-arithmetic','unrecognized opcode: fc 13'],
  ['typed-function-references','unrecognized opcode: 14 0'],
  ['typed-function-references','invalid result type for select'],
  ['custom-page-sizes','unexpected bits set in flags: 8'],
  ['shared-everything-threads','expected type form'],
  ['shared-everything-threads','unexpected bits set in global flags'],
  ['stack-switching','expected type form'],
  ['memory-control','unrecognized opcode: fc 12'],
  ['half-precision','unrecognized opcode: fd 120'],
  ['stringref','unrecognized opcode: fb a9'],
  ['acquire-release-atomics','greater than natural alignment'],
  ['custom-descriptors','expected type form'],
  ['relaxed-simd','unrecognized opcode: fd 10b'],
  ['exceptions','unrecognized opcode: 1f 0'],
  ['tail-call','unrecognized opcode: 12 0'],
  ['memory64','unexpected bits set in flags: 4'],
  ['multi-memory','the number of memories must be at most one'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'a'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: at offset 12: ${reason}`}));
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature+' '+reason);
  const wrong=structuredClone(failures);wrong[1].reason='error: incorrect result: scalar oracle mismatch';
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures:wrong}),null);
 }
});

test('JSC exact source decoder gaps are source and artifact bound',()=>{
 const source={repository:'WebKit/WebKit',revision:'b'.repeat(40)},engine='jsc';
 for(const [feature,reason] of [
  ['compact-imports',"can't get 0th Import's kind in module 'wasmbench' field ''"],
  ['custom-page-sizes','resizable limits flag are not valid 09'],
  ['shared-everything-threads','0th Type is non-Func, non-Struct, and non-Array -27'],
  ['shared-everything-threads',"invalid Global's mutability: 0x03"],
  ['stack-switching','1th Type is non-Func, non-Struct, and non-Array -35'],
  ['memory-control','invalid 0xfc extended op 18, in function at index 0'],
  ['half-precision','invalid extended simd op 288, in function at index 0'],
  ['stringref','invalid extended GC op 169, in function at index 0'],
  ['acquire-release-atomics',"byte alignment 17179869184 does not match against atomic op's natural alignment 4"],
  ['custom-descriptors','0th Type is non-Func, non-Struct, and non-Array -51'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'c'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: WebAssembly.Module doesn't parse at byte 24: ${reason} (evaluating 'new WebAssembly.Module(data)')`}));
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature+' '+reason);
  const wrong=structuredClone(failures);wrong[1].reason='error: incorrect result: scalar oracle mismatch';
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures:wrong}),null);
 }
});

test('Wasmi exact source proposal gaps are source and artifact bound',()=>{
 const source={repository:'wasmi-labs/wasmi',revision:'d'.repeat(40)},engine='wasmi';
 for(const [feature,reason] of [
  ['gc','struct indexed types not supported without the gc feature'],
  ['gc','array indexed types not supported without the gc feature'],
  ['gc','gc support is not enabled'],
  ['gc','gc proposal must be enabled to use subtypes'],
  ['compact-imports','invalid leading byte (0x7f) for external kind'],
  ['typed-function-references','function references required for index reference types'],
  ['exceptions','exceptions proposal not enabled'],
  ['legacy-exceptions','exceptions proposal not enabled'],
  ['shared-everything-threads','shared composite types require the shared-everything-threads proposal'],
  ['shared-everything-threads','malformed mutability -- or shared globals require the shared-everything-threads proposal'],
  ['stack-switching','cannot define continuation types when stack switching is disabled'],
  ['memory-control','memory control support is not enabled'],
  ['half-precision','unknown 0xfd subopcode: 0x120'],
  ['stringref','unknown 0xfb subopcode: 0xa9'],
  ['acquire-release-atomics','threads must be enabled for shared memories'],
  ['custom-descriptors','invalid leading byte (0x4d) for type'],
  ['extended-name-section','exceptions proposal not enabled'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'e'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: ${reason} (at offset 0x1a)`}));
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature+' '+reason);
 }
});

test('WAMR exact declared proposal gaps are source, backend and artifact bound',()=>{
 const source={repository:'bytecodealliance/wasm-micro-runtime',revision:'d'.repeat(40)};
 for(const engine of ['wamr','wamr-fast-jit','wamr-llvm-jit'])for(const feature of ['relaxed-simd','exceptions','compact-imports','custom-page-sizes','shared-everything-threads','stack-switching','memory-control','half-precision','stringref','acquire-release-atomics','custom-descriptors','wide-arithmetic']){
  const w={id:`features/${feature}/case/1`,sha256:'e'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: module validation/loading rejected input`}));
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature);
  const incorrect=structuredClone(failures);incorrect[1].status='incorrect_result';incorrect[1].reason='error: incorrect result: scalar oracle mismatch';
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures:incorrect}),null);
 }
});
test('WAMR LLVM interpreter-only proposals stay backend-specific',()=>{
 const source={repository:'bytecodealliance/wasm-micro-runtime',revision:'d'.repeat(40)};
 for(const feature of ['memory64','multi-memory','legacy-exceptions']){
  const w={id:`features/${feature}/case/1`,sha256:'e'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  for(const engine of ['wamr-llvm-jit','wamr']){
   const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
   const failures=[{engine,workload:w.id,phase:'first-call',status:'error',reason:'error: module validation/loading rejected input'}];
   assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,engine==='wamr-llvm-jit'?'unsupported':undefined,feature+' '+engine);
  }
 }
});
test('wasm3 source-declared gaps are classified without hiding claimed feature failures',()=>{
 const source={repository:'wasm3/wasm3',revision:'d'.repeat(40)};
 for(const [feature,reason] of [
  ['simd','unknown opcode'],
  ['relaxed-simd','unknown type'],
  ['gc','malformed Wasm binary'],
  ['shared-everything-threads','malformed Wasm binary'],
  ['legacy-exceptions','compiling function underran the stack'],
  ['memory-control','unknown opcode'],
  ['half-precision','incorrect type on stack'],
  ['stringref','incorrect type on stack'],
  ['acquire-release-atomics','[trap] unaligned atomic'],
  ['custom-descriptors','malformed Wasm binary'],
  ['typed-function-references','unknown value_type'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'e'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine:'wasm3',workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine:'wasm3',workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: ${reason}`}));
  assert.equal(classifyFeatureRuntimeRejection({source,engine:'wasm3',workload:w,capture,failures})?.status,'unsupported',feature);
 }
 for(const [feature,reason] of [['custom-page-sizes','adapter terminated before response (see trial log)']]){
  const w={id:`features/${feature}/case/1`,sha256:'e'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine:'wasm3',workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=[{engine:'wasm3',workload:w.id,phase:'first-call',status:'error',reason:`error: ${reason}`}];
  assert.equal(classifyFeatureRuntimeRejection({source,engine:'wasm3',workload:w,capture,failures}),null,feature);
 }
});
