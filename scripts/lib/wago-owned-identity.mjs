// PR snapshots opt into Wago's owned numeric host reference without changing
// the identity-v1 contract or the frozen historical embedding.
export function withWagoOwnedIdentity(source){
 const before='if a.prep.Workload.HostProfile == "identity-v1" {\n\t\t\t\t\ta.imports = identityImports()';
 const after='if a.prep.Workload.HostProfile == "identity-v1" {\n\t\t\t\t\ta.hostRuntime = wago.NewRuntime()\n\t\t\t\t\ta.hostIdentity, e = a.hostRuntime.NewHostFuncRef(func(v int32) int32 { return v }, wago.FuncSig{Params: []wago.ValType{wago.ValI32}, Results: []wago.ValType{wago.ValI32}})\n\t\t\t\t\tif e != nil {\n\t\t\t\t\t\tbreak\n\t\t\t\t\t}\n\t\t\t\t\ta.imports = wago.NewImports().Function("wasmbench", "identity", a.hostIdentity)';
 const oldPolicy='direct typed func(int32) int32 import; preserves scalar host-call fast path; no owned funcref wrapper';
 const policy='owned typed func(int32) int32 HostFuncRef; identity-v1 signature; owner runtime retained across measured samples';
 if(source.includes(after)){
  if(source.split(after).length!==2||source.split(policy).length!==2)throw Error('Wago owned identity adapter changed');
  return source;
 }
 if(source.split(before).length!==2||source.split(oldPolicy).length!==2)throw Error('Wago identity adapter source changed');
 return source.replace(before,after).replace(oldPolicy,policy);
}
