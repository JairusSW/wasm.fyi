import test from 'node:test';
import assert from 'node:assert/strict';
import {wasmedgeProposalPolicy} from './lib/wasmedge-feature-policy.mjs';

const source='struct Engine { Engine(){if(!config)throw std::runtime_error("configuration creation failed");WasmEdge_ConfigureSetRunMode(config,WasmEdge_RunMode_Interpreter);} };';
const headers=['TailCall','GC','Threads','ExceptionHandling'].map(x=>'WasmEdge_Proposal_'+x).join('\n');

test('enables every proposal exposed by an interpreter SDK',()=>{
 const result=wasmedgeProposalPolicy(source,headers);
 assert.deepEqual(result.enabled,['tail-call','gc','threads','exceptions-final']);
 for(const name of ['TailCall','GC','Threads','ExceptionHandling'])assert.match(result.source,new RegExp('AddProposal\\(config,WasmEdge_Proposal_'+name+'\\)'));
});

test('enables every proposal exposed by a current JIT SDK',()=>{
 const result=wasmedgeProposalPolicy(source,headers,{jit:true});
 assert.deepEqual(result.enabled,['tail-call','gc','threads','exceptions-final']);
 assert.deepEqual(result.backendExcluded,[]);
 for(const name of ['TailCall','GC','Threads','ExceptionHandling'])assert.match(result.source,new RegExp('AddProposal\\(config,WasmEdge_Proposal_'+name+'\\)'));
});

test('discovers proposal names from the installed generated enum list',()=>{
 const result=wasmedgeProposalPolicy(source,'P(TailCall, "Tail Call")\nP(GC, "Garbage Collection")\nP(WideArithmetic, "Wide Arithmetic")');
 assert.deepEqual(result.enabled,['tail-call','gc','wide-arithmetic']);
 assert.match(result.source,/WasmEdge_LogOff\(\)/);
});

test('upgrades an already patched V1 adapter without duplicating proposal calls',()=>{
 const old=source.replace(
  'if(!config)throw std::runtime_error("configuration creation failed");',
  '// WASMFYI_WASMEDGE_PROPOSALS_V1: opt-in proposals exposed by this exact SDK.\n        WasmEdge_ConfigureAddProposal(config,WasmEdge_Proposal_TailCall);\n        WasmEdge_ConfigureAddProposal(config,WasmEdge_Proposal_Threads);\n        if(!config)throw std::runtime_error("configuration creation failed");'
 );
 const result=wasmedgeProposalPolicy(old,headers,{jit:true});
 assert.equal(result.source.match(/WasmEdge_Proposal_TailCall/g)?.length,1);
 assert.equal(result.source.match(/WasmEdge_Proposal_GC/g)?.length,1);
 assert.match(result.source,/WASMFYI_WASMEDGE_PROPOSALS_V2/);
 assert.doesNotMatch(result.source,/WASMFYI_WASMEDGE_PROPOSALS_V1/);
});
