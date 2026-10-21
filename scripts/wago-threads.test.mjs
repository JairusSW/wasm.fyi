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
test('current adapters retain their existing scoped thread implementation',()=>{
 const current=`describe:
\t\t\t\tresp.Description.Capabilities["can_host_profile_threads-defined-v1"] = true
\t\t\t\tresp.Description.Capabilities["can_host_profile_threads-identity-v1"] = true
\t\t\t\tresp.Description.Capabilities["can_host_profile_threads-opaque-identity-v1"] = true
\t\t\tcase "prepare":
if w.HostProfile == "threads-defined-v1" {
 cfg = cfg.WithFeature(wago.CoreFeatureThreads, true)
}`;
 const output=withWagoThreads(current);
 assert(output.includes(WAGO_THREADS_POLICY));
 assert(output.includes('resp.Description.Features = append(resp.Description.Features, "threads")'));
 assert.equal(output.match(/WithFeature\(wago\.CoreFeatureThreads, true\)/g).length,1);
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
