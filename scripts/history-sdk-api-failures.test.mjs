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
