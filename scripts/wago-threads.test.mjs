import test from 'node:test';
import assert from 'node:assert/strict';
import {withWagoThreads,applyWagoThreads,WAGO_THREADS_POLICY} from './lib/wago-threads.mjs';
const fixture=()=>`describe:
\t\t\tcase "prepare":
if a.prep.Workload.HostProfile == "identity-v1" {
 a.imports = identityImports()
}
a.compileConfig = wago.NewRuntimeConfig().WithMaxModuleBytes(uint64(len(a.wasm)))
`;
test('thread activation is workload-scoped and preserves ordinary identity binding',()=>{
 const output=withWagoThreads(fixture());
 assert.match(output,/if strings.HasPrefix\(a.prep.Workload.ID, "features\/threads\/"\).*\{\n\s*a.compileConfig = a.compileConfig.WithFeature\(wago.CoreFeatureThreads, true\)/);
 assert.match(output,/else if a.prep.Workload.HostProfile == "identity-v1" \{\n a.imports = identityImports\(\)/);
 for(const name of ['threads-defined-v1','threads-identity-v1','threads-opaque-identity-v1'])assert(output.includes(name));
 assert(output.includes(WAGO_THREADS_POLICY));
 assert.equal(withWagoThreads(output),output);
});
test('unknown and ambiguous adapters are rejected',()=>{
 assert.throws(()=>withWagoThreads('changed adapter'),/seam changed/);
 assert.throws(()=>withWagoThreads(fixture()+fixture()),/seam changed/);
 assert.throws(()=>withWagoThreads('"threads_policy" = "unknown"'),/policy changed/);
});
test('old runtime APIs remain unmodified and do not advertise thread support',async()=>{
 assert.deepEqual(await applyWagoThreads('/does-not-exist','old runtime API'),{policy:WAGO_THREADS_POLICY,available:false});
});
