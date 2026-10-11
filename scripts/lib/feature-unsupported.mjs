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
 return {workload:workload.id,status:'unsupported',reason:'Source-bound Wasmer Cranelift compiler rejects the proposed tail-call operator',sourceRevision:source.revision,librarySha256:sdk.librarySha256,artifactSha256:workload.sha256,contractSha256:workloadContract(workload),rawTrials:rejected.map(t=>({id:t.id,reason:t.reason}))};
}
export function classifyFeatureCapture(capture,evidence){
 if(!evidence||!capture.results?.length||capture.results.some(row=>row.engine!=='wasmer-cranelift'||row.workload!==evidence.workload||row.artifactSha256!==evidence.artifactSha256||row.contractSha256!==evidence.contractSha256||row.latencyStatus!=='failed'||(row.timingSamples||0)!==0||(row.samplesNs?.length||0)!==0))return null;
 return {...capture,results:capture.results.map(row=>({...row,latencyStatus:'unsupported'}))};
}
