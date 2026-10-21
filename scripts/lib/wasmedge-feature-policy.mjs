import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

const marker='WASMFYI_WASMEDGE_PROPOSALS_V2';
const oldMarker='WASMFYI_WASMEDGE_PROPOSALS_V1';
const proposals=[
 ['TailCall','tail-call'],
 ['ExtendedConst','extended-const'],
 ['FunctionReferences','typed-function-references'],
 ['GC','gc'],
 ['MultiMemories','multi-memory'],
 ['Threads','threads'],
 ['RelaxSIMD','relaxed-simd'],
 ['Memory64','memory64'],
 ['ExceptionHandling','exceptions-final']
];

export function wasmedgeProposalPolicy(source,headers,{jit=false}={}) {
 if(source.includes(marker))return {source,enabled:[],alreadyApplied:true};
 const available=proposals.filter(([name])=>headers.includes('WasmEdge_Proposal_'+name));
 const enabled=available;
 const anchor='        if(!config)throw std::runtime_error("configuration creation failed");';
 if(!source.includes(anchor))throw Error('WasmEdge feature-policy seam changed');
 const calls=enabled.map(([name])=>`        WasmEdge_ConfigureAddProposal(config,WasmEdge_Proposal_${name});`).join('\n');
 const oldBlock=new RegExp(`        // ${oldMarker}:[^\\n]*\\n(?:        WasmEdge_ConfigureAddProposal\\(config,WasmEdge_Proposal_[A-Za-z0-9_]+\\);\\n)*`);
 const cleanSource=source.replace(oldBlock,'');
 return {
  source:cleanSource.replace(anchor,`        // ${marker}: opt-in proposals exposed by this exact SDK.\n${calls}\n${anchor}`),
  enabled:enabled.map(([,id])=>id),
  unavailable:proposals.filter(([name])=>!available.some(([candidate])=>candidate===name)).map(([,id])=>id),
  backendExcluded:[],
  alreadyApplied:false
 };
}

export async function applyWasmEdgeFeaturePolicy(root,sdk,configuration) {
 const cpp=join(root,'adapters/native/src/wasmedge.cpp');
 const header=join(sdk,'include/wasmedge/wasmedge.h');
 const before=await readFile(cpp,'utf8'),headers=await readFile(header,'utf8');
 const result=wasmedgeProposalPolicy(before,headers,{jit:configuration==='wasmedge-jit'});
 if(result.source!==before)await writeFile(cpp,result.source);
 return {...result,source:undefined,adapterSha256:digest(Buffer.from(result.source)),headerSha256:digest(Buffer.from(headers))};
}
