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
 {feature:'jspi',reason:/unsupported host profile/},
 {feature:'big-int',reason:/unsupported host profile/},
 {feature:'shared-everything-threads',reason:/shared (?:composite types|globals) require the shared-everything-threads proposal/},
 {feature:'memory-control',reason:/memory control support is not enabled/},
 {feature:'custom-descriptors',reason:/custom descriptors? (?:support is not enabled|proposal must be enabled)/},
 {feature:'half-precision',reason:/unknown 0xfd subopcode: 0x120/},
 {feature:'stringref',reason:/unknown 0xfb subopcode: 0xa9/},
 {feature:'acquire-release-atomics',reason:/(?:atomic instructions must always specify maximum alignment|threads must be enabled for shared memories)/},
 {feature:'reference-types',engine:'wasmtime-winch',reason:/Compilation error: Unsupported Wasm type/},
];

export function featureFailureRecords(note,{engine,workload,capture}){
 if(Array.isArray(note?.failures))return note.failures;
 if(note?.kind!=='capture-error'||typeof note.reason!=='string'||!note.reason)return [];
 return (capture?.results||[]).filter(row=>row.latencyStatus==='failed').map(row=>({engine,workload:workload.id,phase:row.phase,status:'error',reason:note.reason}));
}
// Wago's exact FeatureInfos registry exposes Core 1-3 plus threads. beta.12
// also advertised compact imports, but implemented the earlier draft whose
// import-section count was the expanded import count. The phase-4 proposal and
// wasm-tools 1.260 encode a list of import groups instead. Keep that mismatch
// and beta.12's explicitly documented wide-arithmetic gap revision-bound.
const wagoRejections=[
 {revision:'a3c9d5b2097640899eb37cd5cc68b7bfc348de47',feature:'compact-imports',reason:/decode: wasm decode: (?:invalid import|index out of bounds) at offset/},
 {revision:'a3c9d5b2097640899eb37cd5cc68b7bfc348de47',feature:'wide-arithmetic',reason:/decode: wasm decode: invalid instruction at offset/},
 // beta.12 documents a bounded thread product: exactly one imported shared
 // memory32. Keep these exclusions pinned to that release so beta.13+'s
 // broader defined-memory support remains visible and required to pass.
 {revision:'a3c9d5b2097640899eb37cd5cc68b7bfc348de47',feature:'threads',reason:/threads currently require shared memory to be imported/},
 {revision:'a3c9d5b2097640899eb37cd5cc68b7bfc348de47',feature:'threads',reason:/threads currently require exactly one memory, shared or unshared/},
 {revision:'a3c9d5b2097640899eb37cd5cc68b7bfc348de47',feature:'threads',reason:/threads currently do not support shared memory64/},
 // The beta.12 runner can terminate while probing atomics on an unshared
 // memory. Those exact corpus cases are outside its documented shared-import
 // product; do not generalize the fatal-signal diagnostic to supported cases.
 {revision:'a3c9d5b2097640899eb37cd5cc68b7bfc348de47',feature:'threads',workload:/^features\/threads\/unshared-(?:atomic-load-store|atomic-rmw-add)\//,reason:/Wago engine fatal signal during (?:compile|first-call)/},
 {feature:'custom-page-sizes',reason:/decode: wasm decode: invalid limits at offset/},
 {feature:'shared-everything-threads',reason:/decode: wasm decode: invalid type at offset/},
 {feature:'memory-control',reason:/decode: wasm decode: invalid instruction at offset/},
 {feature:'half-precision',reason:/decode: wasm decode: invalid instruction at offset/},
 {feature:'stringref',reason:/decode: wasm decode: invalid instruction at offset/},
 {feature:'acquire-release-atomics',reason:/validate: wasm validate: invalid alignment in function/},
 {feature:'custom-descriptors',reason:/validate: wasm validate: type mismatch in function/},
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
 {feature:'stack-switching',reason:/Invalid opcode 0xe[0-3]/},
 {feature:'custom-page-sizes',reason:/invalid memory limits flags 0x9/},
 {feature:'acquire-release-atomics',reason:/(?:invalid alignment; expected maximum alignment is 2|shared memories are not supported with --experimental-wasm-shared yet)/},
 {feature:'shared-everything-threads',reason:/(?:invalid atomic opcode: 0xfe[0-9a-f]+|shared memories are not supported with --experimental-wasm-shared yet)/},
 {feature:'memory-control',reason:/invalid numeric opcode: 0xfc12/},
 {feature:'custom-descriptors',reason:/invalid gc opcode: fb2[01]/},
];
const wavmRejections=[
 // This validator compares the whole decoded alignment field against the
 // natural alignment; its feature registry has no acquire-release switch.
 {revision:'4e82bb9fecf9c1bdb4d00f96fa89063ee4382d09',feature:'acquire-release-atomics',reason:/atomic memory operators must have natural alignment: imm\.alignmentLog2 != naturalAlignmentLog2/},
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
 // The exact source CMake checks forbid these Fast JIT combinations. Typed
 // function references share the GC-gated loader. Tail calls and threads are
 // intentionally excluded: their implementations must be enabled and tested.
 ...['gc','typed-function-references','simd','legacy-exceptions','memory64','multi-memory'].map(feature=>({engine:'wamr-fast-jit',revision:'ea5dd88e9ca40a44b6a5d9ffeb87a20833b13b8a',feature,reason:/module validation\/loading rejected input/})),
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
const w2c2Rejections=[
 // The pinned source declares Core 1.0 plus threads/atomics, bulk memory,
 // sign extension and non-trapping conversions. Keep every newer proposal
 // bound to the concrete decoder/compiler diagnostic observed below.
 {feature:'reference-types',reason:/(?:unsupported opcode unknown \(0x25\)|invalid element section offset expression|invalid table section table type)/},
 {feature:'multi-value',reason:/(?:unsupported function type \d+ with \d+ result values|invalid block instruction: expected block type)/},
 {feature:'simd',reason:/unsupported opcode unknown \(0xFD\)/},
 {feature:'relaxed-simd',reason:/(?:unsupported opcode unknown \(0xFD\)|invalid code section local declarations)/},
 {feature:'gc',reason:/(?:invalid function type indicator|unsupported opcode unknown \(0xFB\))/},
 {feature:'exceptions',reason:/(?:unsupported section 13[\s\S]*unsupported opcode unknown \(0x1F\)|unsupported section 13[\s\S]*invalid block instruction: expected block type)/},
 {feature:'tail-call',reason:/unsupported opcode unknown \(0x1[23]\)/},
 {feature:'multi-memory',reason:/(?:invalid memory\.copy instruction: expected memory index 1 to be 0, got 1|guest trap: unreachable)/},
 {feature:'typed-function-references',reason:/(?:invalid element section offset expression|invalid table section table type)/},
 {feature:'memory64',reason:/invalid limit kind/},
 {feature:'compact-imports',reason:/invalid import section import kind/},
 {feature:'custom-page-sizes',reason:/invalid limit kind/},
 {feature:'legacy-exceptions',reason:/unsupported section 13[\s\S]*unsupported opcode unknown \(0x6\)/},
 {feature:'shared-everything-threads',reason:/(?:invalid function type indicator|invalid global section mutability indicator)/},
 {feature:'stack-switching',reason:/invalid function type indicator/},
 {feature:'memory-control',reason:/unsupported opcode unknown \(0x12\)/},
 {feature:'half-precision',reason:/unsupported opcode unknown \(0xFD\)/},
 {feature:'stringref',reason:/unsupported opcode unknown \(0xFB\)/},
 {feature:'wide-arithmetic',reason:/unsupported opcode unknown \(0x1[3-6]\)/},
 {feature:'acquire-release-atomics',reason:/invalid i32\.atomic\.rmw\.(?:add|sub|xchg|xor|cmpxchg) instruction: expected alignment 2, got 34/},
 {feature:'custom-descriptors',reason:/invalid function type indicator/},
 {feature:'extended-const',reason:/invalid global section init expression/},
 {feature:'extended-name-section',reason:/invalid function type indicator/},
];
const wasm2cRejections=[
 // The pinned WABT README marks these proposals unsupported by wasm2c. Keep
 // classification bound to its exact translator diagnostics. Custom page
 // sizes are deliberately absent: wasm2c declares them supported and the
 // adapter enables that feature during translation.
 {feature:'compact-imports',reason:/module uses compact imports, but feature not enabled/},
 {feature:'gc',reason:/(?:unexpected type form \(got 0x(?:50|5e|5f)\)|unexpected opcode: 0xfb)/},
 {feature:'typed-function-references',reason:/(?:unexpected opcode: 0x14|expected valid (?:local|select result) type|table elem type must be a reference type)/},
 {feature:'relaxed-simd',reason:/translation failed: (?:unimplemented: \.\.\.\s*)?$/},
 {feature:'shared-everything-threads',reason:/(?:unexpected type form \(got 0x65\)|global mutability must be 0 or 1)/},
 {feature:'stack-switching',reason:/unexpected type form \(got 0x5d\)/},
 {feature:'memory-control',reason:/unexpected opcode: 0xfc 0x12/},
 {feature:'half-precision',reason:/unexpected opcode: 0xfd 0xa0 0x2/},
 {feature:'stringref',reason:/unexpected opcode: 0xfb/},
 {feature:'acquire-release-atomics',reason:/memory may not be shared: threads not allowed/},
 {feature:'custom-descriptors',reason:/unexpected type form \(got 0x4e\)/},
 {feature:'wide-arithmetic',reason:/translation failed: (?:unimplemented: \.\.\.\s*)?$/},
 {feature:'extended-name-section',reason:/unexpected type form \(got 0x5f\)/},
];
const wazyRejections=[
 // The pinned README declares Core Wasm 3.0's eight folded proposals and
 // threads. Keep post-3.0 proposal gaps tied to Wazy's exact decoder errors;
 // failures in declared proposals (notably typed function references) remain
 // visible for adapter/runtime repair.
 {feature:'compact-imports',reason:/invalid byte for importdesc: 0x7[ef]/},
 {feature:'custom-page-sizes',reason:/invalid byte for limits: 0x9 /},
 {feature:'legacy-exceptions',reason:/legacy exception handling instruction 0x6 not supported/},
 {feature:'shared-everything-threads',reason:/(?:invalid byte: 0x65 != 0x60|invalid byte for mutability: 0x3 != 0x00 or 0x01)/},
 {feature:'stack-switching',reason:/invalid byte: 0x5d != 0x60/},
 {feature:'memory-control',reason:/unknown misc opcode 0x12/},
 {feature:'half-precision',reason:/unknown SIMD instruction/},
 {feature:'stringref',reason:/invalid GC instruction: 0xa9/},
 {feature:'acquire-release-atomics',reason:/invalid memory alignment/},
 {feature:'custom-descriptors',reason:/invalid byte: 0x4d != 0x60/},
 {feature:'wide-arithmetic',reason:/unknown misc opcode 0x1[3-6]/},
];
const wasmedgeRejections=[
 // bee78fc loader/ast/description.cpp accepts only Function/Table/Memory/Global/Tag;
 // include/common/enum.inc exposes no compact-import proposal switch.
 {revision:'bee78fc2e2fec55eb9e88f3d63463a3ba7eef0bb',feature:'compact-imports',reason:/malformed import kind/},
 // The exact SDK proposal enum is the source of truth for these gaps. The
 // adapter enables every proposal exposed by that enum before validation.
 {feature:'shared-everything-threads',reason:/(?:integer representation too long|malformed mutability)/},
 {feature:'stack-switching',reason:/integer representation too long/},
 {feature:'custom-page-sizes',reason:/malformed limits flags/},
 {feature:'legacy-exceptions',reason:/illegal opcode/},
 {feature:'memory-control',reason:/illegal opcode/},
 {feature:'half-precision',reason:/illegal opcode/},
 {feature:'stringref',reason:/illegal opcode/},
 {feature:'acquire-release-atomics',reason:/alignment must not be larger than natural/},
 {feature:'custom-descriptors',reason:/integer representation too long/},
 {feature:'wide-arithmetic',reason:/illegal opcode/},
];
const chicoryRejections=[
 // The exact source README at the pinned revision declares SIMD (interpreter
 // only), tail calls, exception handling, threads, extended constants, GC and
 // multi-memory. These newer encodings are absent from the parser/opcode
 // tables. Bind each disposition to the concrete diagnostic so Chicory bugs
 // in its declared features remain failures.
 {feature:'compact-imports',reason:/malformed import kind/},
 {feature:'custom-page-sizes',reason:/invalid memory limit: 9/},
 {feature:'memory64',reason:/invalid memory limit: 5/},
 {feature:'legacy-exceptions',reason:/illegal opcode, op value 06/},
 {feature:'shared-everything-threads',reason:/(?:Invalid composite type\. Form 0x65|malformed mutability 3)/},
 {feature:'stack-switching',reason:/Invalid composite type\. Form 0x5D/},
 {feature:'memory-control',reason:/illegal opcode, op value FC12/},
 {feature:'half-precision',reason:/unknown memory 0/},
 {feature:'stringref',reason:/illegal opcode, op value FBA9/},
 {feature:'acquire-release-atomics',reason:/invalid memory alignement, current: 34, expected: 2/},
 {feature:'custom-descriptors',reason:/Invalid composite type\. Form 0x4D/},
 {feature:'wide-arithmetic',reason:/illegal opcode, op value FC1[3-6]/},
 {engine:'chicory',feature:'relaxed-simd',reason:/(?:unknown memory 3|illegal opcode, op value FE(?:05|0B)|unexpected end)/},
];
const chasmRejections=[
 // Chasm 2.2.0's pinned README declares Wasm 3.0 except Memory64/SIMD,
 // plus tail calls, extended constants, typed function references, GC,
 // multi-memory, exception handling, extended names and wide arithmetic.
 // Keep newer proposal gaps bound to the exact Kotlin decoder diagnostic.
 {feature:'compact-imports',reason:/UnknownImportDescriptor\(descriptor=12[67]\)/},
 {feature:'custom-page-sizes',reason:/UnknownLimitsFlag\(encoded=9\)/},
 {feature:'legacy-exceptions',reason:/UnknownInstruction\(byte=6\)/},
 {feature:'shared-everything-threads',reason:/(?:InvalidCompositeType\(encoded=101\)|UnknownMutabilityFlag\(encoded=3\))/},
 {feature:'stack-switching',reason:/InvalidCompositeType\(encoded=93\)/},
 {feature:'memory-control',reason:/InvalidPrefixInstruction\(prefix=252, opcode=18\)/},
 {feature:'half-precision',reason:/UnknownInstruction\(byte=32\)/},
 {feature:'stringref',reason:/InvalidPrefixInstruction\(prefix=251, opcode=169\)/},
 {feature:'acquire-release-atomics',reason:/InvalidAlignment\(alignment=34\)/},
 {feature:'custom-descriptors',reason:/InvalidCompositeType\(encoded=77\)/},
];
const wizardRejections=[
 // The pinned Wizard support matrix is backend-specific. V3 supports custom
 // page sizes, while fast-int and SPC reject their memory flag in the shared
 // loader. Keep absent proposals tied to exact decoder diagnostics; native
 // modes additionally require the audited source pin.
 {engine:'wizard-fast-int',feature:'custom-page-sizes',reason:/invalid memory flags 0x09/},
 {engine:'wizard-spc',feature:'custom-page-sizes',reason:/invalid memory flags 0x09/},
 {revision:'399357ce20b8330ddc1888a93cceb0d4cf3762de',engine:'wizard-fast-int',feature:'legacy-exceptions',reason:/SDK guest call failed: trap\[INVALID_OPCODE\]/},
 {revision:'399357ce20b8330ddc1888a93cceb0d4cf3762de',engine:'wizard-spc',feature:'legacy-exceptions',reason:/unsupported opcode: RETHROW/},
 {feature:'compact-imports',reason:/invalid import kind 0x7[EF]/},
 {feature:'shared-everything-threads',reason:/(?:expected type decl code, got 101|invalid global flags 0x03)/},
 {feature:'memory-control',reason:/unsupported opcode 0x00 0xFF \(<invalid>\)/},
 {feature:'half-precision',reason:/unsupported opcode 0x00 0xFF \(<invalid>\)/},
 {feature:'stringref',reason:/unsupported opcode 0x00 0xFF \(<invalid>\)/},
 {feature:'acquire-release-atomics',reason:/expected max alignment 4, got 34/},
 {feature:'custom-descriptors',reason:/expected type decl code, got 77/},
];
const zwasmRejections=[
 // The pinned source declares full Core Wasm 3.0. These proposals are outside
 // that support statement and are rejected by its front-end validator. The C
 // API deliberately exposes only an accepted/rejected verdict, so keep each
 // generic rejection feature-, source-, artifact-, and contract-bound here.
 {feature:'compact-imports',reason:/Zwasm C API failure: (?:compile|instantiate)/},
 {feature:'legacy-exceptions',reason:/Zwasm C API failure: (?:compile|instantiate)/},
 {feature:'shared-everything-threads',reason:/Zwasm C API failure: (?:compile|instantiate)/},
 {feature:'stack-switching',reason:/Zwasm C API failure: (?:compile|instantiate)/},
 {feature:'memory-control',reason:/Zwasm C API failure: (?:compile|instantiate)/},
 {feature:'half-precision',reason:/Zwasm C API failure: (?:compile|instantiate)/},
 {feature:'stringref',reason:/Zwasm C API failure: (?:compile|instantiate)/},
 {feature:'acquire-release-atomics',reason:/Zwasm C API failure: (?:compile|instantiate)/},
 {feature:'custom-descriptors',reason:/Zwasm C API failure: (?:compile|instantiate)/},
 // Its pinned README explicitly limits SIMD execution to the JIT backend.
 {engine:'zwasm-interpreter',feature:'simd',reason:/guest trap: unreachable/},
 {engine:'zwasm-interpreter',feature:'relaxed-simd',reason:/guest trap: unreachable/},
 // The pinned JIT lowering reads and discards SIMD memory indices and its
 // instantiation gate explicitly rejects modules with multiple memories.
 {revision:'51634833f70a90ae605feb8c3227897b8ba4c9a1',engine:'zwasm-jit',feature:'multi-memory',reason:/Zwasm JIT compile: MultipleMemories/},
];
const endiveRejections=[
 // The pinned README declares SIMD, tail calls, exception handling, threads,
 // extended constants, GC and multi-memory. Keep failures in those features
 // visible; these newer proposal encodings are absent from its parser tables.
 // Redline has its own source support contract: its spec-test manifest omits
 // GC, EH and typed function references, and explicitly excludes every SIMD
 // WAST. Bind only the concrete compiler gaps observed from that backend.
 {engine:'endive-redline',feature:'simd',reason:/Opcode not yet supported: (?:I32x4_SPLAT|I8x16_SPLAT|F32x4_SPLAT)/},
 {engine:'endive-redline',feature:'gc',reason:/Opcode not yet supported: (?:STRUCT_NEW|ARRAY_NEW|ARRAY_GET|ARRAY_LEN|REF_I31)/},
 {engine:'endive-redline',feature:'exceptions',reason:/Opcode not yet supported: TRY_TABLE/},
 {engine:'endive-redline',feature:'typed-function-references',reason:/Opcode not yet supported: (?:CALL_REF|REF_AS_NON_NULL)/},
 // Redline documents the base specification plus threads. Its native compiler
 // materializes memory zero only, so multi-memory modules can parse but execute
 // with the wrong memory selected instead of producing an admission error.
 {revision:'46a882af3be60293a9beb2b92e0b1734723a6e44',engine:'endive-redline',feature:'multi-memory',reason:/incorrect result: scalar oracle mismatch/,allowIncorrectResult:true},
 {feature:'compact-imports',reason:/malformed import kind/},
 {feature:'custom-page-sizes',reason:/invalid memory limit: 9/},
 {feature:'legacy-exceptions',reason:/illegal opcode, op value 06/},
 {feature:'shared-everything-threads',reason:/(?:Invalid composite type\. Form 0x65|malformed mutability 3)/},
 {feature:'stack-switching',reason:/Invalid composite type\. Form 0x5D/},
 {feature:'memory-control',reason:/illegal opcode, op value FC12/},
 {feature:'half-precision',reason:/(?:unknown memory 0|labels are not empty)/},
 {feature:'stringref',reason:/illegal opcode, op value FBA9/},
 {feature:'acquire-release-atomics',reason:/invalid memory alignment, current: 34, expected: 2/},
 {feature:'custom-descriptors',reason:/Invalid composite type\. Form 0x4D/},
 {feature:'wide-arithmetic',reason:/illegal opcode, op value FC1[3-6]/},
];
const graalWasmRejections=[
 // The exact pinned SDK option descriptors are recorded during preparation.
 // They expose Core Wasm 3.0 plus memory64, multi-memory, wide arithmetic,
 // threads and legacy EH, but none of these later proposal switches. Bind the
 // disposition to the concrete Graal decoder diagnostic as well as the source,
 // artifact and workload contract below.
 {feature:'compact-imports',reason:/Invalid import type identifier: 0x7[ef]/i},
 {feature:'custom-page-sizes',reason:/Invalid limits prefix \(expected 0x00-0x07, got 0x09\)/},
 {feature:'shared-everything-threads',reason:/(?:Only function types are supported in the type section|Invalid mutability flag: 0x03)/},
 {feature:'stack-switching',reason:/Only function types are supported in the type section/},
 {feature:'memory-control',reason:/Unknown opcode: 0xFC 0x12/i},
 {feature:'half-precision',reason:/Unknown opcode: 0xFD 0x120/i},
 {feature:'stringref',reason:/Unknown opcode: 0xFB 0xA9/i},
 {feature:'acquire-release-atomics',reason:/malformed memop flags: 34 should be < 32/},
 {feature:'custom-descriptors',reason:/Only function types are supported in the type section/},
];

// Wasmtime's validator knows encodings for some proposals which the compiler
// deliberately does not implement. Bind that distinction to the exact source,
// artifact and contract so traps, wrong results and generic compiler errors
// remain failures.
export function classifyFeatureRuntimeRejection({source,engine,workload,capture,failures}){
 const wasmtime=source?.repository==='bytecodealliance/wasmtime'&&['wasmtime','wasmtime-winch'].includes(engine);
 const wago=source?.repository==='wago-org/wago'&&engine==='wago';
 const wasmer=source?.repository==='wasmerio/wasmer'&&['wasmer-singlepass','wasmer-cranelift','wasmer-llvm'].includes(engine);
 const wazero=source?.repository==='tetratelabs/wazero'&&['wazero','wazero-interpreter'].includes(engine);
 const v8=source?.repository==='nodejs/node'&&engine==='v8';
 const wavm=source?.repository==='WAVM/WAVM'&&engine==='wavm';
 const spiderMonkey=source?.repository==='mozilla-firefox/firefox'&&engine==='spidermonkey';
 const jsc=source?.repository==='WebKit/WebKit'&&engine==='jsc';
 const wasmi=source?.repository==='wasmi-labs/wasmi'&&engine==='wasmi';
 const wamr=source?.repository==='bytecodealliance/wasm-micro-runtime'&&['wamr','wamr-fast-jit','wamr-llvm-jit'].includes(engine);
 const wasm3=source?.repository==='wasm3/wasm3'&&engine==='wasm3';
 const w2c2=source?.repository==='turbolent/w2c2'&&engine==='w2c2-gcc';
 const wasm2c=source?.repository==='WebAssembly/wabt'&&engine==='wasm2c-gcc';
 const wazy=source?.repository==='samyfodil/wazy'&&engine==='wazy';
 const wasmedge=source?.repository==='WasmEdge/WasmEdge'&&['wasmedge','wasmedge-jit'].includes(engine);
 const chicory=source?.repository==='dylibso/chicory'&&['chicory','chicory-jit'].includes(engine);
 const chasm=source?.repository==='CharlieTap/chasm'&&engine==='chasm';
 const wizard=source?.repository==='titzer/wizard-engine'&&(engine==='wizard-v3-int'||source.revision==='399357ce20b8330ddc1888a93cceb0d4cf3762de'&&['wizard-fast-int','wizard-spc'].includes(engine));
 const zwasm=source?.repository==='zwasm/zwasm'&&['zwasm-interpreter','zwasm-jit'].includes(engine);
 const endive=source?.repository==='bytecodealliance/endive'&&['endive-interpreter','endive-jit','endive-redline'].includes(engine);
 const graalwasm=source?.repository==='oracle/graal'&&engine==='graalwasm';
 if((!wasmtime&&!wago&&!wasmer&&!wazero&&!v8&&!wavm&&!spiderMonkey&&!jsc&&!wasmi&&!wamr&&!wasm3&&!w2c2&&!wasm2c&&!wazy&&!wasmedge&&!chicory&&!chasm&&!wizard&&!zwasm&&!endive&&!graalwasm)||!/^[a-f0-9]{40}$/.test(source.revision||'')||!workload?.id?.startsWith('features/')||!sha(workload.sha256)||!capture?.results?.length)return null;
 if(capture.source?.revision!==source.revision||capture.source?.repository!==source.repository)return null;
 const contractSha256=workloadContract(workload),failed=capture.results.filter(row=>row.latencyStatus==='failed');
 if(failed.length!==capture.results.length||failed.some(row=>row.engine!==engine||row.workload!==workload.id||row.artifactSha256!==workload.sha256||row.contractSha256!==contractSha256||(row.timingSamples||0)!==0||(row.samplesNs?.length||0)!==0))return null;
 const rejection=(wasmtime?wasmtimeRejections:wago?wagoRejections:wasmer?wasmerRejections:wazero?wazeroRejections:v8?v8Rejections:wavm?wavmRejections:spiderMonkey?spiderMonkeyRejections:jsc?jscRejections:wasmi?wasmiRejections:wamr?wamrRejections:wasm3?wasm3Rejections:w2c2?w2c2Rejections:wasm2c?wasm2cRejections:wazy?wazyRejections:wasmedge?wasmedgeRejections:chicory?chicoryRejections:chasm?chasmRejections:wizard?wizardRejections:zwasm?zwasmRejections:endive?endiveRejections:graalWasmRejections).find(candidate=>(!candidate.engine||candidate.engine===engine)&&(!candidate.revision||candidate.revision===source.revision)&&(!candidate.workload||candidate.workload.test(workload.id))&&workload.features?.includes(candidate.feature)&&failures?.some(failure=>candidate.reason.test(failure.reason||'')));
 if(!rejection||!failures?.length||failures.some(failure=>failure.engine!==engine||failure.workload!==workload.id||(!['error','preflight_failed'].includes(failure.status)&&!(rejection.allowIncorrectResult&&failure.status==='incorrect_result')&&!(failure.status==='unsupported'&&failure.reason==='scenario not advertised'))||(failure.samples?.length||0)!==0))return null;
 const sourceBound=failures.filter(failure=>rejection.reason.test(failure.reason||''));
 if(!sourceBound.length||failures.some(failure=>!sourceBound.includes(failure)&&failure.reason!=='scenario not advertised'))return null;
 const runtime=wasmtime?`Wasmtime ${engine==='wasmtime-winch'?'Winch':'Cranelift'}`:wago?'Wago Railshot':wasmer?`Wasmer ${engine.slice('wasmer-'.length)}`:wazero?`Wazero ${engine==='wazero'?'compiler':'interpreter'}`:v8?'V8 Turboshaft':wavm?'WAVM LLVM':spiderMonkey?'SpiderMonkey Ion':jsc?'JSC OMG':wasmi?'Wasmi':wasm3?'wasm3':w2c2?'w2c2 GCC':wasm2c?'wasm2c GCC':wazy?'Wazy':wasmedge?`WasmEdge ${engine==='wasmedge-jit'?'JIT':'interpreter'}`:chicory?`Chicory ${engine==='chicory-jit'?'compiler':'interpreter'}`:chasm?'Chasm':wizard?`Wizard ${engine==='wizard-v3-int'?'V3 interpreter':engine==='wizard-fast-int'?'fast interpreter':'Singlepass'}`:zwasm?`Zwasm ${engine==='zwasm-jit'?'JIT':'interpreter'}`:endive?`Endive ${engine.slice('endive-'.length)}`:graalwasm?'GraalWasm Truffle':`WAMR ${engine==='wamr-llvm-jit'?'LLVM JIT':engine==='wamr-fast-jit'?'Fast JIT':'interpreter'}`;
 return {engine,workload:workload.id,status:'unsupported',reason:`Source-bound ${runtime} compiler rejects ${rejection.feature}`,sourceRevision:source.revision,artifactSha256:workload.sha256,contractSha256,rawFailures:failures.map(({phase,reason})=>({phase,reason}))};
}
