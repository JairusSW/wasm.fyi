import test from 'node:test';
import assert from 'node:assert/strict';
import {wasmedgeProposalPolicy,wasmedgeProtocolOutputPolicy} from './lib/wasmedge-feature-policy.mjs';

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
 assert.match(result.source,/WASMFYI_WASMEDGE_PROPOSALS_V3/);
 assert.doesNotMatch(result.source,/WASMFYI_WASMEDGE_PROPOSALS_V1/);
});

test('JIT excludes annotations that invalidate even MVP compilation, migrating V2',()=>{
 const extended=headers+'\nWasmEdge_Proposal_Annotations';
 const interpreter=wasmedgeProposalPolicy(source,extended);
 assert.ok(interpreter.enabled.includes('custom-annotation-syntax-in-the-text-format'));
 const old=interpreter.source.replace('WASMFYI_WASMEDGE_PROPOSALS_V3','WASMFYI_WASMEDGE_PROPOSALS_V2');
 const jit=wasmedgeProposalPolicy(old,extended,{jit:true});
 assert.deepEqual(jit.backendExcluded,['custom-annotation-syntax-in-the-text-format']);
 assert.doesNotMatch(jit.source,/AddProposal\(config,WasmEdge_Proposal_Annotations\)/);
 assert.equal(jit.source.match(/AddProposal\(config,WasmEdge_Proposal_GC\)/g)?.length,1);
 assert.equal(wasmedgeProposalPolicy(jit.source,extended,{jit:true}).source,jit.source);
});

test('keeps WasmEdge and JIT diagnostics off the JSON protocol stream',()=>{
 const body=`#include <cstdio>\nstatic bool capture_native_size=false;\nvoid* wb_engine_new(){WB_TRY{return nullptr;}WB_CATCH(nullptr)}\nvoid* wb_module_new(int){WB_TRY{return nullptr;}WB_CATCH(nullptr)}\nvoid* wb_instance_new(int){WB_TRY{return nullptr;}WB_CATCH(nullptr)}\nint wb_call(int){WB_TRY{return 0;}WB_CATCH(-1)}`;
 const result=wasmedgeProtocolOutputPolicy(body);
 assert.match(result.source,/WASMFYI_WASMEDGE_PROTOCOL_STDOUT_V1/);
 assert.equal(result.source.match(/ProtocolStdoutGuard protocol_stdout/g)?.length,4);
 assert.equal(wasmedgeProtocolOutputPolicy(result.source).source,result.source);
});
