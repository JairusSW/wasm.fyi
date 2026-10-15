import test from 'node:test';
import assert from 'node:assert/strict';
import {withWagoDirectIdentity,WAGO_IDENTITY_POLICY} from './lib/wago-direct-identity.mjs';
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
f.Invoke(a.prep.Workload.Args...)
func identityImports() *wago.Imports {
 imports := wago.NewImports()
 imports.HostFunc("wasmbench", "identity", func(v int32) int32 { return v })
 return imports
}`;
test('direct typed callback remains the standard embedding',()=>{
 const original=source();
 assert.equal(withWagoDirectIdentity(original),original);
});
test('restores an owned snapshot without changing abort handling, lifetime cleanup or export entry',()=>{
 const original=source();
 const direct='if a.prep.Workload.HostProfile == "identity-v1" {\n\t\t\t\t\ta.imports = identityImports()';
 const owned='if a.prep.Workload.HostProfile == "identity-v1" {\n\t\t\t\t\ta.hostRuntime = wago.NewRuntime()\n\t\t\t\t\ta.hostIdentity, e = a.hostRuntime.NewHostFuncRef(func(v int32) int32 { return v }, wago.FuncSig{Params: []wago.ValType{wago.ValI32}, Results: []wago.ValType{wago.ValI32}})\n\t\t\t\t\tif e != nil {\n\t\t\t\t\t\tbreak\n\t\t\t\t\t}\n\t\t\t\t\ta.imports = wago.NewImports().Function("wasmbench", "identity", a.hostIdentity)';
 const previous=original.replace(direct,owned).replace(WAGO_IDENTITY_POLICY,'owned typed func(int32) int32 HostFuncRef; identity-v1 signature; owner runtime retained across measured samples');
 const updated=withWagoDirectIdentity(previous);
 assert.equal(updated,original);
 assert.equal(withWagoDirectIdentity(updated),updated);
});
test('unknown or mislabeled callbacks fail closed',()=>{
 assert.throws(()=>withWagoDirectIdentity('different adapter'),/source changed/);
 assert.throws(()=>withWagoDirectIdentity(source().replace('return v','return v + 1')),/callback changed/);
 assert.throws(()=>withWagoDirectIdentity(source().replace(WAGO_IDENTITY_POLICY,'unknown policy')),/source changed/);
});
