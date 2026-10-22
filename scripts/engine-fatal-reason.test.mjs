import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyEngineFatals} from './lib/engine-fatal-reason.mjs';
import {historyIntegrationFailure} from './lib/history-completion-audit.mjs';
const reason='adapter terminated before response (see trial log)';
const fatal='zwasm: internal error — caught a fatal signal. This is a bug in zwasm (not a wasm trap); please report it.';
const trial={runtime_configuration:'zwasm-jit',workload:'exceptions',scenario:'first-call',block:0,status:'error',reason,log:'logs/trial-0.log'};
test('explicit engine fatal diagnostic classifies its own failure and propagated phases',async()=>{
 const propagated={...trial,scenario:'steady',reason:`adaptive phase first-call: ${reason}`,log:'logs/trial-1.log'};
 const other={...propagated,workload:'another'};
 const result=await identifyEngineFatals([trial,propagated,other],async()=>fatal+'\n');
 assert.equal(result[0].originalReason,reason);
 assert.match(result[0].reason,/engine fatal signal during first-call/);
 assert.equal(historyIntegrationFailure(result[0]),false);
 assert.equal(historyIntegrationFailure(result[1]),false);
 assert.equal(historyIntegrationFailure(result[2]),true);
 assert.equal(trial.reason,reason);
});
test('unknown disconnects, diagnostics from other engines and invalid log paths stay pending',async()=>{
 for(const change of [{},{runtime_configuration:'wasmtime'},{log:'../outside'},{status:'ok'}]){
  const row={...trial,...change};let reads=0;
  const [result]=await identifyEngineFatals([row],async()=>{reads++;return 'segmentation fault'});
  assert.equal(result.reason,reason);
  if(change.runtime_configuration||change.log||change.status)assert.equal(reads,0);
 }
 const [mixed]=await identifyEngineFatals([trial],async()=>fatal+'\nTraceback: adapter bug');
 assert.equal(mixed.reason,reason);
});

const wagoLog='SIGSEGV: segmentation violation\nPC=0x1234 m=0 sigcode=1 addr=0x8\n\ngoroutine 1 [syscall]:\ngithub.com/wago-org/wago/src/core/runtime.enterNative(0x1234)\n\tsrc/core/runtime/native_scheduler.go:21\ngithub.com/wago-org/wago/src/core/runtime.(*Engine).CallPrepared(0x1234)\n';
test('Wago guest native entry crash stays failed without holding unrelated features',async()=>{
 const row={...trial,runtime_configuration:'wago'};
 const [result]=await identifyEngineFatals([row],async()=>wagoLog);
 assert.equal(result.status,'error');assert.equal(result.originalReason,reason);assert.equal(historyIntegrationFailure(result),false);assert.match(result.reason,/Wago engine fatal signal/);
});
test('Wago startup faults and generic segmentation messages stay pending',async()=>{
 for(const log of ['segmentation fault',wagoLog.replace('runtime.enterNative','runtime.notGuest'),wagoLog.replace('runtime.(*Engine).CallPrepared','runtime.main'),wagoLog.replace('SIGSEGV: segmentation violation','adapter startup failed')]){
  const [result]=await identifyEngineFatals([{...trial,runtime_configuration:'wago'}],async()=>log);assert.equal(result.reason,reason);assert.equal(historyIntegrationFailure(result),true);
 }
});
