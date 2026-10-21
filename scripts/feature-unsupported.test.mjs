import test from 'node:test';import assert from 'node:assert/strict';import {classifyFeatureCompilerRejection} from './lib/feature-unsupported.mjs';import {workloadContract} from './lib/workload-contract.mjs';
const revision='4a7f16c1154251fdc7b2de43b213c1043ad65d76',librarySha256='b'.repeat(64);
const workload={id:'features/tail-call/direct-recursion/1',sha256:'a'.repeat(64),abi:'core',features:['tail-call'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
const make=()=>({source:{revision,repository:'wasmerio/wasmer'},engine:'wasmer-cranelift',workload:structuredClone(workload),manifest:{lock:{workloads:[structuredClone(workload)],runtime_configurations:[{id:'wasmer-cranelift',file_sha256:{'/sdk/libwasmer.so':librarySha256},description:{backend:'cranelift-jit',effective_configuration:{native_sdk_receipt:JSON.stringify({revision,librarySha256})}}}]}},trials:[{id:'check-0-0',runtime_configuration:'wasmer-cranelift',workload:workload.id,status:'error',samples:null,reason:'error: compile: WebAssembly translation error: Unsupported feature: proposed tail-call operator ReturnCall { function_index: 0 }'}]});
test('actual proposed tail-call compiler rejection is source and artifact bound',()=>{assert.equal(classifyFeatureCompilerRejection(make()).status,'unsupported');const indirect=make();indirect.trials[0].reason='error: compile: WebAssembly translation error: Unsupported feature: proposed tail-call operator ReturnCallIndirect { type_index: 0, table_index: 0 }';assert.equal(classifyFeatureCompilerRejection(indirect).status,'unsupported')});
test('oracle, profile, trap and unbound compiler failures remain failures',()=>{
 for(const reason of ['error: incorrect result','error: unsupported host profile','error: trap: unreachable','error: compile: unsupported instruction']){const v=make();v.trials[0].reason=reason;assert.equal(classifyFeatureCompilerRejection(v),null)}
 for(const mutate of [v=>v.source.revision='c'.repeat(40),v=>v.workload.sha256='d'.repeat(64),v=>v.workload.oracle.expected=['1'],v=>v.manifest.lock.runtime_configurations[0].description.backend='singlepass-jit',v=>v.manifest.lock.runtime_configurations[0].file_sha256['/sdk/libwasmer.so']='e'.repeat(64),v=>v.trials[0].samples=[{verified:true}],v=>v.trials[0].workload='other']){const v=make();mutate(v);assert.equal(classifyFeatureCompilerRejection(v),null)}
});
import {classifyFeatureCapture,classifyFeatureRuntimeRejection,featureFailureRecords} from './lib/feature-unsupported.mjs';
test('capture annotation changes failed zero-sample status only, preserves resources',()=>{
 const evidence=classifyFeatureCompilerRejection(make());
 const capture={capturedAt:'2026-10-10T00:00:00Z',platform:{memoryBytes:123},results:[{engine:'wasmer-cranelift',workload:workload.id,artifactSha256:workload.sha256,contractSha256:evidence.contractSha256,phase:'compile',latencyStatus:'failed',timingSamples:0,samplesNs:[],memoryStatus:'not-measured',codeStatus:'not-measured'}]};
 const after=classifyFeatureCapture(capture,evidence);assert.deepEqual(after,{...capture,results:[{...capture.results[0],latencyStatus:'unsupported'}]});assert.equal(capture.results[0].latencyStatus,'failed');
 const measured=structuredClone(capture);measured.results[0].samplesNs=[1];assert.equal(classifyFeatureCapture(measured,evidence),null);
 const mixed=structuredClone(capture);mixed.results[0].latencyStatus='ok';assert.equal(classifyFeatureCapture(mixed,evidence),null);
});

test('source-bound rejection covers only its unadvertised propagated phases',()=>{
 const featureWorkload={id:'features/memory-control/performance/1',sha256:'c'.repeat(64),abi:'core',features:['memory-control'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
 const source={repository:'bytecodealliance/wasmtime',revision:'d'.repeat(40)},contractSha256=workloadContract(featureWorkload);
 const capture={source,results:['compile','instantiate'].map(phase=>({engine:'wasmtime',workload:featureWorkload.id,artifactSha256:featureWorkload.sha256,contractSha256,phase,latencyStatus:'failed',timingSamples:0,samplesNs:[]}))};
 const rejected={engine:'wasmtime',workload:featureWorkload.id,phase:'compile',status:'error',reason:'memory control support is not enabled'};
 const propagated={engine:'wasmtime',workload:featureWorkload.id,phase:'instantiate',status:'unsupported',reason:'scenario not advertised'};
 assert.equal(classifyFeatureRuntimeRejection({source,engine:'wasmtime',workload:featureWorkload,capture,failures:[rejected,propagated]})?.status,'unsupported');
 assert.equal(classifyFeatureRuntimeRejection({source,engine:'wasmtime',workload:featureWorkload,capture,failures:[propagated]}),null);
 assert.equal(classifyFeatureRuntimeRejection({source,engine:'wasmtime',workload:featureWorkload,capture,failures:[rejected,{...propagated,reason:'error: incorrect result'}]}),null);
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

test('capture errors retain exact diagnostics for source-bound classification',()=>{
 const engine='wasmtime',featureWorkload={id:'features/half-precision/lane-add/1',sha256:'c'.repeat(64),abi:'core',features:['half-precision'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}},source={repository:'bytecodealliance/wasmtime',revision:'d'.repeat(40)};
 const capture={source,results:[{engine,workload:featureWorkload.id,artifactSha256:featureWorkload.sha256,contractSha256:workloadContract(featureWorkload),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
 const note={kind:'capture-error',reason:'Error: independent validation: Error: unknown 0xfd subopcode: 0x120 (at offset 0x3c)'};
 const failures=featureFailureRecords(note,{engine,workload:featureWorkload,capture});
 assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:featureWorkload,capture,failures})?.status,'unsupported');
 assert.deepEqual(featureFailureRecords({kind:'capture-error',reason:''},{engine,workload:featureWorkload,capture}),[]);
});

test('Wasmtime sacrificial preflight and exact proposal encoding rejections remain source bound',()=>{
 const source={repository:'bytecodealliance/wasmtime',revision:'e'.repeat(40)};
 for(const [feature,engine,reason] of [
  ['half-precision','wasmtime','unknown 0xfd subopcode: 0x120'],
  ['stringref','wasmtime','unknown 0xfb subopcode: 0xa9'],
  ['acquire-release-atomics','wasmtime','atomic instructions must always specify maximum alignment'],
  ['acquire-release-atomics','wasmtime-winch','threads must be enabled for shared memories'],
  ['custom-descriptors','wasmtime','custom descriptors proposal must be enabled'],
  ['shared-everything-threads','wasmtime','shared composite types require the shared-everything-threads proposal'],
  ['shared-everything-threads','wasmtime-winch','shared globals require the shared-everything-threads proposal'],
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

test('Chasm 2.2.0 decoder gaps stay bounded by its declared proposal table',()=>{
 const source={repository:'CharlieTap/chasm',revision:'2'.repeat(40)},engine='chasm';
 for(const [feature,reason] of [
  ['compact-imports','DecodeError(error=UnknownImportDescriptor(descriptor=127))'],
  ['custom-page-sizes','DecodeError(error=UnknownLimitsFlag(encoded=9))'],
  ['legacy-exceptions','DecodeError(error=UnknownInstruction(byte=6))'],
  ['shared-everything-threads','DecodeError(error=InvalidCompositeType(encoded=101))'],
  ['shared-everything-threads','DecodeError(error=UnknownMutabilityFlag(encoded=3))'],
  ['stack-switching','DecodeError(error=InvalidCompositeType(encoded=93))'],
  ['memory-control','DecodeError(error=InvalidPrefixInstruction(prefix=252, opcode=18))'],
  ['half-precision','DecodeError(error=UnknownInstruction(byte=32))'],
  ['stringref','DecodeError(error=InvalidPrefixInstruction(prefix=251, opcode=169))'],
  ['acquire-release-atomics','DecodeError(error=InvalidAlignment(alignment=34))'],
  ['custom-descriptors','DecodeError(error=InvalidCompositeType(encoded=77))'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'3'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: module decode failed: ${reason}`}));
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature);
 }
 const declared={id:'features/gc/case/1',sha256:'3'.repeat(64),abi:'core',features:['gc'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
 const capture={source,results:[{engine,workload:declared.id,artifactSha256:declared.sha256,contractSha256:workloadContract(declared),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
 const failures=[{engine,workload:declared.id,phase:'first-call',status:'error',reason:'error: module decode failed: DecodeError(error=InvalidCompositeType(encoded=101))'}];
 assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:declared,capture,failures}),null);
});

test('Wizard V3 classifies only proposals absent from its pinned support table',()=>{
 const source={repository:'titzer/wizard-engine',revision:'4'.repeat(40)},engine='wizard-v3-int';
 for(const [feature,reason] of [
  ['compact-imports','invalid import kind 0x7F'],
  ['shared-everything-threads','expected type decl code, got 101'],
  ['shared-everything-threads','invalid global flags 0x03'],
  ['memory-control','unsupported opcode 0x00 0xFF (<invalid>)'],
  ['half-precision','unsupported opcode 0x00 0xFF (<invalid>)'],
  ['stringref','unsupported opcode 0x00 0xFF (<invalid>)'],
  ['acquire-release-atomics','expected max alignment 4, got 34'],
  ['custom-descriptors','expected type decl code, got 77'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'4'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=[{engine,workload:w.id,phase:'first-call',status:'error',reason:`error: ${reason}`}];
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature);
 }
 const w={id:'features/legacy-exceptions/case/1',sha256:'4'.repeat(64),abi:'core',features:['legacy-exceptions'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
 const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
 const failures=[{engine,workload:w.id,phase:'first-call',status:'error',reason:'error: opcode 06 (try) requires "legacy-eh" extension'}];
 assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures}),null);
});

test('V8 exact flagged proposal gaps are source and artifact bound',()=>{
 const source={repository:'nodejs/node',revision:'5'.repeat(40)},engine='v8';
 for(const [feature,reason] of [
  ['stack-switching','WebAssembly.Module(): Compiling function #1 failed: Invalid opcode 0xe0 @+72'],
  ['stack-switching','WebAssembly.Module(): Compiling function #1 failed: Invalid opcode 0xe2 @+73'],
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

test('w2c2 classifies only exact gaps outside its pinned declared feature set',()=>{
 const source={repository:'turbolent/w2c2',revision:'e'.repeat(40)},engine='w2c2-gcc';
 for(const [feature,reason] of [
  ['reference-types','unsupported opcode unknown (0x25)'],
  ['multi-value','unsupported function type 0 with 2 result values'],
  ['simd','unsupported opcode unknown (0xFD)'],
  ['relaxed-simd','invalid code section local declarations'],
  ['gc','invalid function type indicator'],
  ['exceptions',"skipping unsupported section 13\nw2c2: unsupported opcode unknown (0x1F)"],
  ['tail-call','unsupported opcode unknown (0x13)'],
  ['multi-memory','invalid memory.copy instruction: expected memory index 1 to be 0, got 1'],
  ['multi-memory','guest trap: unreachable'],
  ['typed-function-references','invalid table section table type'],
  ['memory64','invalid limit kind'],
  ['compact-imports','invalid import section import kind'],
  ['custom-page-sizes','invalid limit kind'],
  ['legacy-exceptions',"skipping unsupported section 13\nw2c2: unsupported opcode unknown (0x6)"],
  ['shared-everything-threads','invalid global section mutability indicator'],
  ['stack-switching','invalid function type indicator'],
  ['memory-control','unsupported opcode unknown (0x12)'],
  ['half-precision','unsupported opcode unknown (0xFD)'],
  ['stringref','unsupported opcode unknown (0xFB)'],
  ['wide-arithmetic','unsupported opcode unknown (0x16)'],
  ['acquire-release-atomics','invalid i32.atomic.rmw.cmpxchg instruction: expected alignment 2, got 34'],
  ['custom-descriptors','invalid function type indicator'],
  ['extended-const','invalid global section init expression'],
  ['extended-name-section','invalid function type indicator'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'f'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=[{engine,workload:w.id,phase:'first-call',status:'error',reason:`adaptive phase compile: error: translation failed: w2c2: ${reason}`}];
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature+' '+reason);
 }
 const w={id:'features/simd/case/1',sha256:'f'.repeat(64),abi:'core',features:['simd'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
 const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
 for(const reason of ['error: incorrect result: scalar oracle mismatch','error: guest trap: unreachable','error: unsupported instruction'])assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures:[{engine,workload:w.id,phase:'first-call',status:'error',reason}]}),null,reason);
 assert.equal(classifyFeatureRuntimeRejection({source:{...source,repository:'other/w2c2'},engine,workload:w,capture:{...capture,source:{...source,repository:'other/w2c2'}},failures:[{engine,workload:w.id,phase:'first-call',status:'error',reason:'unsupported opcode unknown (0xFD)'}]}),null);
});

test('Wazy classifies exact post-3.0 gaps but preserves declared feature failures',()=>{
 const source={repository:'samyfodil/wazy',revision:'1'.repeat(40)},engine='wazy';
 for(const [feature,reason] of [
  ['compact-imports','import[0] 0x7f[wasmbench.]: invalid byte: invalid byte for importdesc: 0x7f'],
  ['custom-page-sizes','section memory: invalid byte for limits: 0x9 not in (0x00, 0x01)'],
  ['legacy-exceptions','legacy exception handling instruction 0x6 not supported'],
  ['shared-everything-threads','global[0]: invalid byte for mutability: 0x3 != 0x00 or 0x01'],
  ['stack-switching','section type: read 1-th type: invalid byte: 0x5d != 0x60'],
  ['memory-control','unknown misc opcode 0x12'],
  ['half-precision','unknown SIMD instruction'],
  ['stringref','invalid GC instruction: 0xa9'],
  ['acquire-release-atomics','invalid memory alignment'],
  ['custom-descriptors','invalid byte: 0x4d != 0x60'],
  ['wide-arithmetic','unknown misc opcode 0x16'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'1'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=[{engine,workload:w.id,phase:'first-call',status:'error',reason:`error: ${reason}`}];
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature);
 }
 const w={id:'features/typed-function-references/selected-target/1',sha256:'1'.repeat(64),abi:'core',features:['typed-function-references'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
 const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
 const failures=[{engine,workload:w.id,phase:'first-call',status:'error',reason:'error: wasm error: unreachable'}];
 assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures}),null);
});

test('Zwasm classifies source-declared gaps and interpreter-only SIMD absence',()=>{
 const source={repository:'zwasm/zwasm',revision:'5'.repeat(40)};
 for(const [engine,feature,reason] of [
  ['zwasm-interpreter','compact-imports','error: Zwasm C API failure: compile'],
  ['zwasm-jit','custom-descriptors','sacrificial check check-0-0: error: Zwasm C API failure: compile'],
  ['zwasm-interpreter','simd','error: guest trap: unreachable'],
  ['zwasm-interpreter','relaxed-simd','sacrificial check check-0-0: error: guest trap: unreachable'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'5'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=[{engine,workload:w.id,phase:'first-call',status:'error',reason}];
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',`${engine} ${feature}`);
 }
 for(const [engine,feature,reason] of [
  ['zwasm-jit','simd','error: guest trap: unreachable'],
  ['zwasm-interpreter','typed-function-references','error: Zwasm C API failure: compile'],
  ['zwasm-interpreter','gc','error: resource budget exceeded'],
  ['zwasm-interpreter','multi-value','error: guest trap: unreachable'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'5'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=[{engine,workload:w.id,phase:'first-call',status:'error',reason}];
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures}),null,`${engine} ${feature}`);
 }
});

test('Endive classifies parser gaps while preserving README-declared features',()=>{
 const source={repository:'bytecodealliance/endive',revision:'6'.repeat(40)};
 const classify=(engine,feature,reason)=>{
  const w={id:`features/${feature}/case/1`,sha256:'6'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  return classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures:[{engine,workload:w.id,phase:'first-call',status:'error',reason:`error: ${reason}`}]});
 };
 for(const [feature,reason] of [
  ['compact-imports','malformed import kind'],
  ['custom-page-sizes','integer too large, invalid memory limit: 9'],
  ['legacy-exceptions','illegal opcode, op value 06'],
  ['shared-everything-threads','Invalid composite type. Form 0x65 was not 0x60'],
  ['stack-switching','Invalid composite type. Form 0x5D was not 0x60'],
  ['memory-control','illegal opcode, op value FC12'],
  ['half-precision','unknown memory 0'],
  ['half-precision','labels are not empty'],
  ['stringref','illegal opcode, op value FBA9'],
  ['acquire-release-atomics','invalid memory alignment, current: 34, expected: 2'],
  ['custom-descriptors','Invalid composite type. Form 0x4D was not 0x60'],
  ['wide-arithmetic','illegal opcode, op value FC16'],
 ])for(const engine of ['endive-interpreter','endive-jit','endive-redline'])assert.equal(classify(engine,feature,reason)?.status,'unsupported',`${engine} ${feature}`);
 for(const [feature,reason] of [
  ['simd','incorrect result: scalar oracle mismatch'],
  ['tail-call','labels are not empty'],
  ['exceptions','guest trap: unreachable'],
  ['threads','guest trap: unreachable'],
  ['extended-const','incorrect result: scalar oracle mismatch'],
  ['gc','guest trap: unreachable'],
  ['multi-memory','unknown memory 0'],
  ['multi-value','labels are not empty'],
 ])assert.equal(classify('endive-interpreter',feature,reason),null,feature);
 for(const [feature,reason] of [
  ['simd','Failed to compile function 0: Opcode not yet supported: I32x4_SPLAT'],
  ['gc','Failed to compile function 0: Opcode not yet supported: STRUCT_NEW'],
  ['exceptions','Failed to compile function 0: Opcode not yet supported: TRY_TABLE'],
  ['typed-function-references','Failed to compile function 2: Opcode not yet supported: CALL_REF'],
 ]){
  assert.equal(classify('endive-redline',feature,reason)?.status,'unsupported',`redline ${feature}`);
  assert.equal(classify('endive-jit',feature,reason),null,`jit ${feature}`);
 }
 assert.equal(classify('endive-redline','multi-memory','incorrect result: scalar oracle mismatch'),null);
});

test('GraalWasm classifies only proposals absent from exact SDK descriptors',()=>{
 const source={repository:'oracle/graal',revision:'7'.repeat(40)},engine='graalwasm';
 const classify=(feature,reason)=>{
  const w={id:`features/${feature}/case/1`,sha256:'7'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=['preflight_failed','error'].map(status=>({engine,workload:w.id,phase:'first-call',status,reason:`${status==='preflight_failed'?'sacrificial check check-0-0: ':''}error: ${reason}`}));
  return classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures});
 };
 for(const [feature,reason] of [
  ['compact-imports','Invalid import type identifier: 0x7f'],
  ['custom-page-sizes','Invalid limits prefix (expected 0x00-0x07, got 0x09)'],
  ['shared-everything-threads','Only function types are supported in the type section'],
  ['stack-switching','Only function types are supported in the type section'],
  ['memory-control','Unknown opcode: 0xFC 0x12'],
  ['half-precision','Unknown opcode: 0xFD 0x120'],
  ['stringref','Unknown opcode: 0xFB 0xA9'],
  ['acquire-release-atomics','malformed memop flags: 34 should be < 32'],
  ['custom-descriptors','Only function types are supported in the type section'],
 ])assert.equal(classify(feature,reason)?.status,'unsupported',feature);
 for(const [feature,reason] of [
  ['memory64','Invalid limits prefix'],
  ['threads','guest trap: unreachable'],
  ['gc','Unknown opcode: 0xFB 0x00'],
  ['tail-call','Unknown opcode: 0x12'],
 ])assert.equal(classify(feature,reason),null,feature);
});

test('wasm2c classifies exact documented gaps but keeps declared custom pages repairable',()=>{
 const source={repository:'WebAssembly/wabt',revision:'f'.repeat(40)},engine='wasm2c-gcc';
 for(const [feature,reason] of [
  ['compact-imports','module uses compact imports, but feature not enabled'],
  ['gc','unexpected type form (got 0x5e)'],
  ['typed-function-references','unexpected opcode: 0x14'],
  ['relaxed-simd',''],
  ['shared-everything-threads','global mutability must be 0 or 1'],
  ['stack-switching','unexpected type form (got 0x5d)'],
  ['memory-control','unexpected opcode: 0xfc 0x12'],
  ['half-precision','unexpected opcode: 0xfd 0xa0 0x2'],
  ['stringref','unexpected opcode: 0xfb'],
  ['acquire-release-atomics','memory may not be shared: threads not allowed'],
  ['custom-descriptors','unexpected type form (got 0x4e)'],
  ['wide-arithmetic','unimplemented: ...'],
  ['extended-name-section','unexpected type form (got 0x5f)'],
 ]){
  const w={id:`features/${feature}/case/1`,sha256:'a'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'compile',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  const failures=[{engine,workload:w.id,phase:'compile',status:'error',reason:`adaptive phase compile: error: translation failed: ${reason}`}];
  assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures})?.status,'unsupported',feature);
 }
 const w={id:'features/custom-page-sizes/case/1',sha256:'a'.repeat(64),abi:'core',features:['custom-page-sizes'],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
 const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'compile',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
 const failures=[{engine,workload:w.id,phase:'compile',status:'error',reason:'error: translation failed: custom page sizes not allowed'}];
 assert.equal(classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures}),null);
});

test('Wago classifies only proposal encodings absent from its beta feature registry',()=>{
 const source={repository:'wago-org/wago',revision:'a'.repeat(40)};
 const runtimeCase=({source,engine,feature,reason})=>{
  const w={id:`features/${feature}/case/1`,sha256:'b'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  return classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures:[{engine,workload:w.id,phase:'first-call',status:'error',reason}]});
 };
 const unsupported=runtimeCase({source,engine:'wago',feature:'custom-page-sizes',reason:'error: decode: wasm decode: invalid limits at offset 23 in section 5 [22,31)'});
 assert.equal(unsupported?.status,'unsupported');
 assert.equal(runtimeCase({source,engine:'wago',feature:'threads',reason:'error: validate: wasm validate: invalid alignment in function 0'}),null);
 assert.equal(runtimeCase({source,engine:'wago',feature:'custom-page-sizes',reason:'guest returned wrong result'}),null);
});

test('WasmEdge classifies exact SDK proposal gaps without hiding traps',()=>{
 const source={repository:'WasmEdge/WasmEdge',revision:'c'.repeat(40)},engine='wasmedge-jit';
 const classify=(feature,reason)=>{
  const w={id:`features/${feature}/case/1`,sha256:'d'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  return classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures:[{engine,workload:w.id,phase:'first-call',status:'error',reason}]});
 };
 assert.equal(classify('wide-arithmetic','error: illegal opcode')?.status,'unsupported');
 assert.equal(classify('custom-page-sizes','error: malformed limits flags')?.status,'unsupported');
 assert.equal(classify('threads','error: guest trap: unreachable'),null);
});

test('Chicory classifies only exact source-absent proposal encodings',()=>{
 const source={repository:'dylibso/chicory',revision:'e'.repeat(40)};
 const classify=(engine,feature,reason)=>{
  const w={id:`features/${feature}/case/1`,sha256:'f'.repeat(64),abi:'core',features:[feature],export:'benchmark',args:['1'],reset:'stateless',oracle:{kind:'exact_u64',expected:['0']}};
  const capture={source,results:[{engine,workload:w.id,artifactSha256:w.sha256,contractSha256:workloadContract(w),phase:'first-call',latencyStatus:'failed',timingSamples:0,samplesNs:[]}]};
  return classifyFeatureRuntimeRejection({source,engine,workload:w,capture,failures:[{engine,workload:w.id,phase:'first-call',status:'error',reason}]});
 };
 for(const [feature,reason] of [
  ['compact-imports','malformed import kind'],
  ['custom-page-sizes','integer too large, invalid memory limit: 9'],
  ['memory64','integer too large, invalid memory limit: 5'],
  ['legacy-exceptions','illegal opcode, op value 06'],
  ['shared-everything-threads','Invalid composite type. Form 0x65 was not 0x5E'],
  ['stack-switching','Invalid composite type. Form 0x5D was not 0x5E'],
  ['memory-control','illegal opcode, op value FC12'],
  ['half-precision','unknown memory 0'],
  ['stringref','illegal opcode, op value FBA9'],
  ['acquire-release-atomics','invalid memory alignement, current: 34, expected: 2'],
  ['custom-descriptors','Invalid composite type. Form 0x4D was not 0x5E'],
  ['wide-arithmetic','illegal opcode, op value FC16'],
 ])for(const engine of ['chicory','chicory-jit'])assert.equal(classify(engine,feature,reason)?.status,'unsupported',`${engine} ${feature}`);
 assert.equal(classify('chicory','relaxed-simd','illegal opcode, op value FE05')?.status,'unsupported');
 assert.equal(classify('chicory-jit','relaxed-simd','illegal opcode, op value FE05'),null);
 for(const [feature,reason] of [
  ['multi-value','incorrect result: scalar oracle mismatch'],
  ['reference-types','Cannot read the array length because local is null'],
  ['tail-call','Index 3 out of bounds for length 3'],
  ['threads','guest trap: unreachable'],
 ])assert.equal(classify('chicory',feature,reason),null,feature);
});
