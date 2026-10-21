import {workloadContract} from './workload-contract.mjs';
const sha=value=>/^[a-f0-9]{64}$/.test(value||'');
// This is a backend compiler rejection, not an admission or oracle failure.
export function classifyFeatureCompilerRejection({source,engine,workload,manifest,trials}) {
 if(source?.repository!=='wasmerio/wasmer'||engine!=='wasmer-cranelift'||!workload.id.startsWith('features/tail-call/')||!workload.features?.includes('tail-call'))return null;
 const runtime=manifest?.lock?.runtime_configurations?.find(r=>r.id===engine),actual=manifest?.lock?.workloads?.find(w=>w.id===workload.id);
 if(runtime?.description?.backend!=='cranelift-jit'||actual?.sha256!==workload.sha256||workloadContract(actual)!==workloadContract(workload))return null;
 let sdk;try{sdk=JSON.parse(runtime.description.effective_configuration.native_sdk_receipt)}catch{return null}
 if(!/^[a-f0-9]{40}$/.test(source?.revision||'')||sdk.revision!==source.revision||!sha(sdk.librarySha256))return null;
 const files={...runtime.file_sha256,...runtime.description.host_file_sha256};
 if(!Object.entries(files).some(([path,value])=>/libwasmer\.(?:so|dylib)$/.test(path)&&value===sdk.librarySha256))return null;
 const rejected=trials.filter(t=>t.runtime_configuration===engine&&t.workload===workload.id&&t.status==='error'&&!(t.samples?.length)&&/^error: compile: WebAssembly translation error: Unsupported feature: proposed tail-call operator ReturnCall(?:Indirect)? \{[^}]+\}$/.test(t.reason||''));
 if(!rejected.length)return null;
 return {engine,workload:workload.id,status:'unsupported',reason:'Source-bound Wasmer Cranelift compiler rejects the proposed tail-call operator',sourceRevision:source.revision,librarySha256:sdk.librarySha256,artifactSha256:workload.sha256,contractSha256:workloadContract(workload),rawTrials:rejected.map(t=>({id:t.id,reason:t.reason}))};
}
export function classifyFeatureCapture(capture,evidence){
 if(!evidence||!capture.results?.length||capture.results.some(row=>row.engine!==evidence.engine||row.workload!==evidence.workload||row.artifactSha256!==evidence.artifactSha256||row.contractSha256!==evidence.contractSha256||row.latencyStatus!=='failed'||(row.timingSamples||0)!==0||(row.samplesNs?.length||0)!==0))return null;
 return {...capture,results:capture.results.map(row=>({...row,latencyStatus:'unsupported'}))};
}

const wasmtimeRejections=[
 {feature:'shared-everything-threads',reason:/shared (?:composite types|globals) require the shared-everything-threads proposal/},
 {feature:'memory-control',reason:/memory control support is not enabled/},
 {feature:'custom-descriptors',reason:/custom descriptors? (?:support is not enabled|proposal must be enabled)/},
 {feature:'half-precision',reason:/unknown 0xfd subopcode: 0x120/},
 {feature:'stringref',reason:/unknown 0xfb subopcode: 0xa9/},
 {feature:'acquire-release-atomics',reason:/(?:atomic instructions must always specify maximum alignment|threads must be enabled for shared memories)/},
 {feature:'reference-types',engine:'wasmtime-winch',reason:/Compilation error: Unsupported Wasm type/},
];
const wasmerRejections=[
 {feature:'compact-imports',reason:/invalid leading byte 0x7[EF] with compact imports proposal disabled/},
 {feature:'custom-page-sizes',reason:/custom page sizes proposal must be enabled to customize a memory's page size/},
 {feature:'half-precision',reason:/unknown 0xfd subopcode: 0x120/},
 {feature:'stringref',reason:/unknown 0xfb subopcode: 0xa9/},
 {feature:'acquire-release-atomics',reason:/atomic instructions must always specify maximum alignment/},
 {feature:'memory-control',reason:/memory control support is not enabled/},
 {feature:'shared-everything-threads',reason:/shared (?:composite types|globals) require the shared-everything-threads proposal/},
 {feature:'legacy-exceptions',reason:/legacy_exceptions feature required for try instruction/},
];
const wazeroRejections=[
 {feature:'wide-arithmetic',reason:/unknown misc opcode 0x1[3-6]/},
 {feature:'compact-imports',reason:/invalid byte for importdesc: 0x7[ef]/i},
 {feature:'custom-page-sizes',reason:/invalid byte for limits: 0x9 not in \(0x00, 0x01, 0x02, 0x03\)/},
 {feature:'memory-control',reason:/unknown misc opcode 0x12/},
 {feature:'half-precision',reason:/cannot pop the operand for i32x4\.abs: type mismatch: expected v128, but was f32/},
 {feature:'stringref',reason:/invalid instruction 0xfb/},
 {feature:'acquire-release-atomics',reason:/invalid memory alignment/},
 {feature:'shared-everything-threads',reason:/invalid byte for mutability: 0x3 != 0x00 or 0x01/},
];
const v8Rejections=[
 {feature:'custom-page-sizes',reason:/invalid memory limits flags 0x9/},
 {feature:'acquire-release-atomics',reason:/(?:invalid alignment; expected maximum alignment is 2|shared memories are not supported with --experimental-wasm-shared yet)/},
 {feature:'shared-everything-threads',reason:/(?:invalid atomic opcode: 0xfe[0-9a-f]+|shared memories are not supported with --experimental-wasm-shared yet)/},
 {feature:'memory-control',reason:/invalid numeric opcode: 0xfc12/},
 {feature:'custom-descriptors',reason:/invalid gc opcode: fb2[01]/},
];
const wavmRejections=[
 {feature:'gc',reason:/(?:unknown function type tag \((?:80|94|95)\)|unknown opcode \(64284\))/},
 {feature:'exceptions',reason:/unknown section ID \(13/},
 {feature:'legacy-exceptions',reason:/unknown section ID \(13/},
 {feature:'tail-call',reason:/unknown opcode \((?:18|19)\)/},
 {feature:'compact-imports',reason:/(?:invalid value type encoding|invalid reference type encoding)/},
 {feature:'relaxed-simd',reason:/unknown opcode \(253 2(?:56|59|61|67)\)/},
 {feature:'typed-function-references',reason:/(?:unknown opcode \(20\)|invalid (?:value|reference) type encoding)/},
 {feature:'custom-page-sizes',reason:/unknown memory type flag/},
 {feature:'shared-everything-threads',reason:/(?:unknown function type tag \(101\)|Invalid unsigned LEB encoding)/},
 {feature:'stack-switching',reason:/unknown function type tag \(93\)/},
 {feature:'memory-control',reason:/unknown opcode \(64530\)/},
 {feature:'half-precision',reason:/unknown opcode \(253 288\)/},
 {feature:'stringref',reason:/unknown opcode \(64425\)/},
 {feature:'acquire-release-atomics',reason:/(?:invalid alignment|unknown atomic opcode|shared memory requires atomics feature)/},
 {feature:'custom-descriptors',reason:/unknown function type tag \(78\)/},
 {feature:'wide-arithmetic',reason:/unknown opcode \(6453[1-4]\)/},
 {feature:'extended-const',reason:/expected end opcode: loaded 65 but was expecting 11/},
 {feature:'extended-name-section',reason:/unknown function type tag \(95\)/},
];
const spiderMonkeyRejections=[
 {feature:'gc',reason:/(?:Structure types not enabled|gc types not enabled|expected type form|unrecognized opcode: fb 1c)/},
 {feature:'compact-imports',reason:/unsupported import kind/},
 {feature:'wide-arithmetic',reason:/unrecognized opcode: fc 1[3-6]/},
 {feature:'typed-function-references',reason:/(?:unrecognized opcode: 14 0|bad type|invalid result type for select)/},
 {feature:'custom-page-sizes',reason:/unexpected bits set in flags: 8/},
 {feature:'shared-everything-threads',reason:/(?:expected type form|unexpected bits set in global flags)/},
 {feature:'stack-switching',reason:/expected type form/},
 {feature:'memory-control',reason:/unrecognized opcode: fc 12/},
 {feature:'half-precision',reason:/unrecognized opcode: fd 120/},
 {feature:'stringref',reason:/unrecognized opcode: fb a9/},
 {feature:'acquire-release-atomics',reason:/greater than natural alignment/},
 {feature:'custom-descriptors',reason:/expected type form/},
 {feature:'relaxed-simd',reason:/unrecognized opcode: fd 10(?:0|3|5|b)/},
 {feature:'exceptions',reason:/unrecognized opcode: 1f 0/},
 {feature:'tail-call',reason:/unrecognized opcode: 1[23] 0/},
 {feature:'memory64',reason:/unexpected bits set in flags: 4/},
 {feature:'multi-memory',reason:/the number of memories must be at most one/},
];
const jscRejections=[
 {feature:'compact-imports',reason:/can't get \d+(?:th|st|nd|rd) Import's kind in module 'wasmbench' field ''/},
 {feature:'custom-page-sizes',reason:/resizable limits flag are not valid 09/},
 {feature:'shared-everything-threads',reason:/(?:Type is non-Func, non-Struct, and non-Array -27|invalid Global's mutability: 0x03)/},
 {feature:'stack-switching',reason:/Type is non-Func, non-Struct, and non-Array -35/},
 {feature:'memory-control',reason:/invalid 0xfc extended op 18/},
 {feature:'half-precision',reason:/invalid extended simd op 288/},
 {feature:'stringref',reason:/invalid extended GC op 169/},
 {feature:'acquire-release-atomics',reason:/byte alignment 17179869184 does not match against atomic op's natural alignment 4/},
 {feature:'custom-descriptors',reason:/Type is non-Func, non-Struct, and non-Array -51/},
];
const wasmiRejections=[
 {feature:'gc',reason:/(?:struct|array) indexed types not supported without the gc feature|gc (?:support is not enabled|proposal must be enabled to use subtypes)/},
 {feature:'compact-imports',reason:/invalid leading byte \(0x7[ef]\) for external kind/},
 {feature:'typed-function-references',reason:/(?:function references support is not enabled|function references required for index reference types)/},
 {feature:'exceptions',reason:/exceptions proposal not enabled/},
 {feature:'legacy-exceptions',reason:/exceptions proposal not enabled/},
 {feature:'shared-everything-threads',reason:/(?:shared composite types require the shared-everything-threads proposal|malformed mutability -- or shared globals require the shared-everything-threads proposal)/},
 {feature:'stack-switching',reason:/cannot define continuation types when stack switching is disabled/},
 {feature:'memory-control',reason:/memory control support is not enabled/},
 {feature:'half-precision',reason:/unknown 0xfd subopcode: 0x120/},
 {feature:'stringref',reason:/unknown 0xfb subopcode: 0xa9/},
 {feature:'acquire-release-atomics',reason:/threads must be enabled for shared memories/},
 {feature:'custom-descriptors',reason:/invalid leading byte \(0x4d\) for type/},
 {feature:'extended-name-section',reason:/(?:struct indexed types not supported without the gc feature|exceptions proposal not enabled)/},
];
const wamrRejections=[
 // WAMR's pinned build rules restrict these proposals to the classic
 // interpreter; the LLVM JIT deliberately builds them out.
 {engine:'wamr-llvm-jit',feature:'memory64',reason:/module validation\/loading rejected input/},
 {engine:'wamr-llvm-jit',feature:'multi-memory',reason:/module validation\/loading rejected input/},
 {engine:'wamr-llvm-jit',feature:'legacy-exceptions',reason:/module validation\/loading rejected input/},
 {feature:'relaxed-simd',reason:/module validation\/loading rejected input/},
 {feature:'exceptions',reason:/module validation\/loading rejected input/},
 {feature:'compact-imports',reason:/module validation\/loading rejected input/},
 {feature:'custom-page-sizes',reason:/module validation\/loading rejected input/},
 {feature:'shared-everything-threads',reason:/module validation\/loading rejected input/},
 {feature:'stack-switching',reason:/module validation\/loading rejected input/},
 {feature:'memory-control',reason:/module validation\/loading rejected input/},
 {feature:'half-precision',reason:/module validation\/loading rejected input/},
 {feature:'stringref',reason:/module validation\/loading rejected input/},
 {feature:'acquire-release-atomics',reason:/module validation\/loading rejected input/},
 {feature:'custom-descriptors',reason:/module validation\/loading rejected input/},
 {feature:'wide-arithmetic',reason:/module validation\/loading rejected input/},
];
const wasm3Rejections=[
 // The pinned source README declares fixed-width SIMD, GC and full threads N/A;
 // its configuration also states that relaxed SIMD is absent. Typed function
 // references are explicitly partial, so reject only the exact value-type gap.
 // Custom page sizes are declared ready and must remain a repairable failure.
 {feature:'simd',reason:/unknown (?:type|opcode|label)/},
 {feature:'relaxed-simd',reason:/unknown (?:type|label)/},
 {feature:'gc',reason:/malformed Wasm binary/},
 {feature:'shared-everything-threads',reason:/malformed Wasm binary/},
 {feature:'legacy-exceptions',reason:/compiling function underran the stack/},
 {feature:'memory-control',reason:/unknown opcode/},
 {feature:'half-precision',reason:/incorrect type on stack/},
 {feature:'stringref',reason:/incorrect type on stack/},
 {feature:'acquire-release-atomics',reason:/\[trap\] unaligned atomic/},
 {feature:'custom-descriptors',reason:/malformed Wasm binary/},
 {feature:'typed-function-references',reason:/unknown value_type/},
];

// Wasmtime's validator knows encodings for some proposals which the compiler
// deliberately does not implement. Bind that distinction to the exact source,
// artifact and contract so traps, wrong results and generic compiler errors
// remain failures.
export function classifyFeatureRuntimeRejection({source,engine,workload,capture,failures}){
 const wasmtime=source?.repository==='bytecodealliance/wasmtime'&&['wasmtime','wasmtime-winch'].includes(engine);
 const wasmer=source?.repository==='wasmerio/wasmer'&&['wasmer-singlepass','wasmer-cranelift','wasmer-llvm'].includes(engine);
 const wazero=source?.repository==='tetratelabs/wazero'&&['wazero','wazero-interpreter'].includes(engine);
 const v8=source?.repository==='nodejs/node'&&engine==='v8';
 const wavm=source?.repository==='WAVM/WAVM'&&engine==='wavm';
 const spiderMonkey=source?.repository==='mozilla-firefox/firefox'&&engine==='spidermonkey';
 const jsc=source?.repository==='WebKit/WebKit'&&engine==='jsc';
 const wasmi=source?.repository==='wasmi-labs/wasmi'&&engine==='wasmi';
 const wamr=source?.repository==='bytecodealliance/wasm-micro-runtime'&&['wamr','wamr-fast-jit','wamr-llvm-jit'].includes(engine);
 const wasm3=source?.repository==='wasm3/wasm3'&&engine==='wasm3';
 if((!wasmtime&&!wasmer&&!wazero&&!v8&&!wavm&&!spiderMonkey&&!jsc&&!wasmi&&!wamr&&!wasm3)||!/^[a-f0-9]{40}$/.test(source.revision||'')||!workload?.id?.startsWith('features/')||!sha(workload.sha256)||!capture?.results?.length)return null;
 if(capture.source?.revision!==source.revision||capture.source?.repository!==source.repository)return null;
 const contractSha256=workloadContract(workload),failed=capture.results.filter(row=>row.latencyStatus==='failed');
 if(failed.length!==capture.results.length||failed.some(row=>row.engine!==engine||row.workload!==workload.id||row.artifactSha256!==workload.sha256||row.contractSha256!==contractSha256||(row.timingSamples||0)!==0||(row.samplesNs?.length||0)!==0))return null;
 const rejection=(wasmtime?wasmtimeRejections:wasmer?wasmerRejections:wazero?wazeroRejections:v8?v8Rejections:wavm?wavmRejections:spiderMonkey?spiderMonkeyRejections:jsc?jscRejections:wasmi?wasmiRejections:wamr?wamrRejections:wasm3Rejections).find(candidate=>(!candidate.engine||candidate.engine===engine)&&workload.features?.includes(candidate.feature));
 if(!rejection||!failures?.length||failures.some(failure=>failure.engine!==engine||failure.workload!==workload.id||(!['error','preflight_failed'].includes(failure.status)&&!(failure.status==='unsupported'&&failure.reason==='scenario not advertised'))||(failure.samples?.length||0)!==0))return null;
 const sourceBound=failures.filter(failure=>rejection.reason.test(failure.reason||''));
 if(!sourceBound.length||failures.some(failure=>!sourceBound.includes(failure)&&failure.reason!=='scenario not advertised'))return null;
 const runtime=wasmtime?`Wasmtime ${engine==='wasmtime-winch'?'Winch':'Cranelift'}`:wasmer?`Wasmer ${engine.slice('wasmer-'.length)}`:wazero?`Wazero ${engine==='wazero'?'compiler':'interpreter'}`:v8?'V8 Turboshaft':wavm?'WAVM LLVM':spiderMonkey?'SpiderMonkey Ion':jsc?'JSC OMG':wasmi?'Wasmi':wasm3?'wasm3':`WAMR ${engine==='wamr-llvm-jit'?'LLVM JIT':engine==='wamr-fast-jit'?'Fast JIT':'interpreter'}`;
 return {engine,workload:workload.id,status:'unsupported',reason:`Source-bound ${runtime} compiler rejects ${rejection.feature}`,sourceRevision:source.revision,artifactSha256:workload.sha256,contractSha256,rawFailures:failures.map(({phase,reason})=>({phase,reason}))};
}
