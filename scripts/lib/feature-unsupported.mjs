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

// Wasmtime's validator knows encodings for some proposals which the compiler
// deliberately does not implement. Bind that distinction to the exact source,
// artifact and contract so traps, wrong results and generic compiler errors
// remain failures.
export function classifyFeatureRuntimeRejection({source,engine,workload,capture,failures}){
 if(source?.repository!=='bytecodealliance/wasmtime'||!['wasmtime','wasmtime-winch'].includes(engine)||!/^[a-f0-9]{40}$/.test(source.revision||'')||!workload?.id?.startsWith('features/')||!sha(workload.sha256)||!capture?.results?.length)return null;
 if(capture.source?.revision!==source.revision||capture.source?.repository!==source.repository)return null;
 const contractSha256=workloadContract(workload),failed=capture.results.filter(row=>row.latencyStatus==='failed');
 if(failed.length!==capture.results.length||failed.some(row=>row.engine!==engine||row.workload!==workload.id||row.artifactSha256!==workload.sha256||row.contractSha256!==contractSha256||(row.timingSamples||0)!==0||(row.samplesNs?.length||0)!==0))return null;
 const rejection=wasmtimeRejections.find(candidate=>(!candidate.engine||candidate.engine===engine)&&workload.features?.includes(candidate.feature));
 if(!rejection||!failures?.length||failures.some(failure=>failure.engine!==engine||failure.workload!==workload.id||!['error','preflight_failed'].includes(failure.status)||!rejection.reason.test(failure.reason||'')||(failure.samples?.length||0)!==0))return null;
 return {engine,workload:workload.id,status:'unsupported',reason:`Source-bound Wasmtime ${engine==='wasmtime-winch'?'Winch':'Cranelift'} compiler rejects ${rejection.feature}`,sourceRevision:source.revision,artifactSha256:workload.sha256,contractSha256,rawFailures:failures.map(({phase,reason})=>({phase,reason}))};
}
