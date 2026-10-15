// Match the ordinary typed identity import used by the other engine adapters.
// This namespace prevents reuse of SDKs and captures with the owned embedding.
export const WAGO_IDENTITY_EMBEDDING = 'direct-identity-v1';
export const WAGO_IDENTITY_POLICY = 'direct typed func(int32) int32 import; preserves scalar host-call fast path; no owned funcref wrapper';
export function withWagoDirectIdentity(source){
 const before='if a.prep.Workload.HostProfile == "identity-v1" {\n\t\t\t\t\ta.imports = identityImports()';
 const after='if a.prep.Workload.HostProfile == "identity-v1" {\n\t\t\t\t\ta.hostRuntime = wago.NewRuntime()\n\t\t\t\t\ta.hostIdentity, e = a.hostRuntime.NewHostFuncRef(func(v int32) int32 { return v }, wago.FuncSig{Params: []wago.ValType{wago.ValI32}, Results: []wago.ValType{wago.ValI32}})\n\t\t\t\t\tif e != nil {\n\t\t\t\t\t\tbreak\n\t\t\t\t\t}\n\t\t\t\t\ta.imports = wago.NewImports().Function("wasmbench", "identity", a.hostIdentity)';
 const oldPolicy=WAGO_IDENTITY_POLICY;
 const policy='owned typed func(int32) int32 HostFuncRef; identity-v1 signature; owner runtime retained across measured samples';
 if(source.includes(after)){
  if(source.split(after).length!==2||source.split(policy).length!==2)throw Error('Wago owned identity adapter changed');
  source = source.replace(after,before).replace(policy,oldPolicy);
 }
 if(source.split(before).length!==2||source.split(oldPolicy).length!==2)throw Error('Wago identity adapter source changed');
 if(!source.includes('imports.HostFunc("wasmbench", "identity", func(v int32) int32 { return v })'))throw Error('Wago direct identity callback changed');
 return source;
}
