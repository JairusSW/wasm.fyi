import test from 'node:test';
import assert from 'node:assert/strict';
import {historyIntegrationFailure,completedHistoryIntegrationFailures} from './lib/history-completion-audit.mjs';

test('historical SDK API failures hold completion without hiding genuine workload outcomes',()=>{
 const reason='sacrificial check check-0-0: error: Redline SDK API unavailable: java.lang.NoSuchMethodException: run.endive.redline.experimental.compiler.internal.NativeCompiler.compile(java.lang.String,run.endive.wasm.WasmModule)';
 for(const error of [{error:reason},{reason},{failures:[{phase:'compile',reason}]}])assert.equal(historyIntegrationFailure(error),true);
 for(const error of ['java.lang.NoSuchMethodError: compile','java.lang.NoClassDefFoundError: run/endive/wasm/WasmModule'])assert.equal(historyIntegrationFailure({error}),true);
 for(const error of ['Workload exceeded 300000 ms','Independent scalar oracle mismatch','unreachable wasm trap','SIMD unsupported by this engine'])assert.equal(historyIntegrationFailure({error}),false);
 const week='2026-10-04T10:00:00.000Z';
 const status={completed:[{engine:'endive',configuration:'endive-redline',asOf:week,pinKey:'redline-oct4',workloadErrors:[{workload:'tiny',error:reason},{workload:'pcre2',error:'Workload exceeded 300000 ms'}]}]};
 const held=completedHistoryIntegrationFailures(status,'endive',week);
 assert.equal(held.length,1);assert.equal(held[0].workload,'tiny');assert.equal(held[0].configuration,'endive-redline');
 assert.equal(completedHistoryIntegrationFailures(status,'endive','2026-09-27T10:00:00.000Z').length,0);
});

test('missing adapter executable holds an engine instead of completing every corpus as failed',()=>{
 const reason='Capture infrastructure failure: wasmbench: build adapter wasmer-singlepass first: open /sdk/bin/adapter-wasmer-singlepass: no such file or directory';
 assert.equal(historyIntegrationFailure({kind:'capture-error',reason}),true);
 assert.equal(historyIntegrationFailure({reason:'wasmbench: open /sdk/bin/adapter-wasmer-cranelift: no such file or directory'}),true);
 assert.equal(historyIntegrationFailure({reason:'error: guest failed to open input: no such file or directory'}),false);
});

test('pre-engine capture admission errors cannot count as completed runtime tests',()=>{
 const signed='Error: Capture infrastructure failure: wasmbench: suite must be core or a workload JSON array: invalid unsigned result "-1152921504606846977"';
 const proposal='Error: Capture infrastructure failure: wasmbench: workload features/half-precision/lane-add/1 admission: independent validation (all): unknown 0xfd subopcode';
 for(const reason of [signed,proposal]){
  assert.equal(historyIntegrationFailure({kind:'capture-error',reason}),true);
  const status={completed:[{engine:'graalwasm',workloadErrors:[{reason}]}]};
  assert.equal(completedHistoryIntegrationFailures(status,'graalwasm').length,1);
 }
 assert.equal(historyIntegrationFailure({kind:'failed-trials',reason:'error: unknown 0xfd subopcode'}),false);
});
