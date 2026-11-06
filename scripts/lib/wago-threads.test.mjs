import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWagoThreads} from './wago-threads.mjs';
test('owned callback adapters keep typed imports when opting into threads',()=>{
 const before=`
\t\t\tcase "prepare":
if a.prep.Workload.HostProfile == "identity-v1" {
 a.hostRuntime = wago.NewRuntime()
\t\t\t\t\ta.hostIdentity, e = a.hostRuntime.NewHostFuncRef(func(v int32) int32 { return v })
}
a.compileConfig = wago.NewRuntimeConfig().WithMaxModuleBytes(uint64(len(a.wasm)))
`;
 const after=withWagoThreads(before);
 assert.ok(after.includes('hostConfig.WithFeature(wago.CoreFeatureThreads, true)'));
 assert.ok(after.includes('wago.WithRuntimeConfig(hostConfig)'));
 assert.ok(!after.includes('identityImports()'));
 assert.equal(withWagoThreads(after),after);
});
