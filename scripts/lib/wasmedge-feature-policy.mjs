import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

const marker='WASMFYI_WASMEDGE_PROPOSALS_V3';
const protocolOutputMarker='WASMFYI_WASMEDGE_PROTOCOL_STDOUT_V1';
const proposals=[
 ['TailCall','tail-call'],
 ['ExtendedConst','extended-const'],
 ['FunctionReferences','typed-function-references'],
 ['GC','gc'],
 ['MultiMemories','multi-memory'],
 ['Threads','threads'],
 ['RelaxSIMD','relaxed-simd'],
 ['Annotations','custom-annotation-syntax-in-the-text-format'],
 ['Memory64','memory64'],
 ['ExceptionHandling','exceptions-final'],
 ['WideArithmetic','wide-arithmetic']
];

export function wasmedgeProposalPolicy(source,headers,{jit=false}={}) {
 if(source.includes(marker))return {source,enabled:[],alreadyApplied:true};
 const available=proposals.filter(([name])=>headers.includes('WasmEdge_Proposal_'+name)||new RegExp(`(?:^|\\n)P\\(${name},`).test(headers));
 // The pinned LLVM compiler rejects Annotations in checkConfigure before
 // compiling any module, including MVP. Its interpreter accepts the option.
 const backendExcluded=jit?available.filter(([name])=>name==='Annotations'):[];
 const enabled=available.filter(proposal=>!backendExcluded.includes(proposal));
 const anchor='if(!config)throw std::runtime_error("configuration creation failed");';
 if(source.split(anchor).length!==2)throw Error('WasmEdge feature-policy seam changed');
 const calls=enabled.map(([name])=>`        WasmEdge_ConfigureAddProposal(config,WasmEdge_Proposal_${name});`).join('\n');
 const oldBlock=/[ \t]*\/\/ WASMFYI_WASMEDGE_PROPOSALS_V[12]:[^\n]*\n(?:[ \t]*WasmEdge_ConfigureAddProposal\(config,WasmEdge_Proposal_[A-Za-z0-9_]+\);\n)*/;
 const cleanSource=source.replace(oldBlock,'');
 return {
  source:cleanSource.replace(anchor,`${anchor}\n        WasmEdge_LogOff();\n        // ${marker}: opt-in proposals exposed by this exact SDK.\n${calls}`),
  enabled:enabled.map(([,id])=>id),
  unavailable:proposals.filter(([name])=>!available.some(([candidate])=>candidate===name)).map(([,id])=>id),
  backendExcluded:backendExcluded.map(([,id])=>id),
  alreadyApplied:false
 };
}

export function wasmedgeProtocolOutputPolicy(source) {
 if(source.includes(protocolOutputMarker))return {source,alreadyApplied:true};
 const include=source.includes('#include <cstdio>')?'#include <cstdio>':'#include "embedding.h"';
 const includes=source.includes('#include <cstdio>')?'#include <cstdio>\n#include <unistd.h>':'#include "embedding.h"\n#include <cstdio>\n#include <unistd.h>';
 const anchor=['static bool capture_native_size=false;','static bool assemblyscript_profile_requested=false;'].find(candidate=>source.includes(candidate));
 if(!anchor)throw Error('WasmEdge protocol-output seam changed');
 let next=source.replace(include,includes).replace(anchor,`${anchor}
// ${protocolOutputMarker}: keep SDK/JIT diagnostics off the JSON control stream.
struct ProtocolStdoutGuard {
    int saved=-1;
    ProtocolStdoutGuard(){fflush(stdout);saved=dup(STDOUT_FILENO);if(saved>=0)dup2(STDERR_FILENO,STDOUT_FILENO);}
    ~ProtocolStdoutGuard(){fflush(stdout);if(saved>=0){dup2(saved,STDOUT_FILENO);close(saved);}}
};`);
 const functions=['wb_engine_new','wb_module_new','wb_instance_new','wb_call'];
 for(const name of functions){
  const seam=name+'(';
  const start=next.indexOf(seam);
  if(start<0)throw Error(`WasmEdge ${name} seam changed`);
  const body=next.indexOf('WB_TRY{',start);
  if(body<0)throw Error(`WasmEdge ${name} guard seam changed`);
  next=next.slice(0,body)+'WB_TRY{ProtocolStdoutGuard protocol_stdout;'+next.slice(body+'WB_TRY{'.length);
 }
 return {source:next,alreadyApplied:false};
}

export async function applyWasmEdgeFeaturePolicy(root,sdk,configuration) {
 const cpp=join(root,'adapters/native/src/wasmedge.cpp');
 const header=join(sdk,'include/wasmedge/wasmedge.h');
 const enumDefinitions=join(sdk,'include/wasmedge/enum.inc');
 const before=await readFile(cpp,'utf8'),headers=(await Promise.all([readFile(header,'utf8'),readFile(enumDefinitions,'utf8')])).join('\n');
 const result=wasmedgeProposalPolicy(before,headers,{jit:configuration==='wasmedge-jit'});
 const output=wasmedgeProtocolOutputPolicy(result.source);
 result.source=output.source;
 if(result.source!==before)await writeFile(cpp,result.source);
 return {...result,source:undefined,adapterSha256:digest(Buffer.from(result.source)),headerSha256:digest(Buffer.from(headers))};
}
