import test from 'node:test';
import assert from 'node:assert/strict';
import {withWagoOwnedIdentity} from './lib/wago-owned-identity.mjs';
// Source excerpts from the existing typed callback adapter. Runtime/API
// compatibility is verified separately against the source-pinned SDK.
const source=()=>String.raw`"host_callback_policy": "direct typed func(int32) int32 import; preserves scalar host-call fast path; no owned funcref wrapper"
				if a.prep.Workload.HostProfile == "identity-v1" {
					a.imports = identityImports()
				} else if a.prep.Workload.HostProfile == protocol.AssemblyScriptAbortProfile {
					/* existing abort callback */
				}
a.hostRuntime.Instantiate(context.Background(), mod, wago.WithImports(a.imports))
a.hostIdentity.Close()
a.hostRuntime.Close()
f.Invoke(a.prep.Workload.Args...)`;
test('private identity adapter retains the exact typed signature and existing runtime ownership lifecycle',()=>{
 const original=source(),updated=withWagoOwnedIdentity(original);
 assert(updated.includes('NewHostFuncRef(func(v int32) int32 { return v }, wago.FuncSig{Params: []wago.ValType{wago.ValI32}, Results: []wago.ValType{wago.ValI32}})'));
 assert(updated.includes('Function("wasmbench", "identity", a.hostIdentity)'));
 assert(updated.includes('a.hostRuntime.Instantiate(context.Background(), mod, wago.WithImports(a.imports))'));
 assert(updated.includes('a.hostIdentity.Close()'));
 assert(updated.includes('a.hostRuntime.Close()'));
 assert.equal(updated.split('f.Invoke(').length,original.split('f.Invoke(').length);
 assert.equal(withWagoOwnedIdentity(updated),updated);
});
test('changed embedding fails closed rather than claiming an owned fast path',()=>{
 assert.throws(()=>withWagoOwnedIdentity('different adapter'),/source changed/);
});
