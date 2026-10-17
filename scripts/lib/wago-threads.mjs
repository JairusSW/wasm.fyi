import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export const WAGO_THREADS_POLICY='opt-in-threads-per-feature-v1';
export function withWagoThreads(source){
 if(source.includes('"threads_policy"')){
  if(!source.includes(WAGO_THREADS_POLICY)||!source.includes('WithFeature(wago.CoreFeatureThreads, true)'))throw Error('Wago threads policy changed');
  return source;
 }
 const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('Wago threads adapter seam changed');source=source.replace(before,after)};
 replace('\t\t\tcase "prepare":',`\t\t\t\tresp.Description.Configuration["threads_policy"] = "${WAGO_THREADS_POLICY}; only thread feature workloads opt in; other workloads keep runtime defaults"
\t\t\t\tif wago.SupportedFeatures()&wago.CoreFeatureThreads != 0 {
\t\t\t\t\tfor _, profile := range []string{"threads-defined-v1", "threads-identity-v1", "threads-opaque-identity-v1"} {
\t\t\t\t\t\tresp.Description.Capabilities["can_host_profile_"+profile] = true
\t\t\t\t\t}
\t\t\t\t\tresp.Description.Features = append(resp.Description.Features, "threads")
\t\t\t\t}
\t\t\tcase "prepare":`);
 replace('if a.prep.Workload.HostProfile == "identity-v1" {',`if a.prep.Workload.HostProfile == "threads-identity-v1" || a.prep.Workload.HostProfile == "threads-opaque-identity-v1" {
\t\t\t\t\ta.imports = identityImports()
\t\t\t\t} else if a.prep.Workload.HostProfile == "threads-defined-v1" {
\t\t\t\t\t// The module defines its shared memory; no host imports are needed.
\t\t\t\t} else if a.prep.Workload.HostProfile == "identity-v1" {`);
 const config='a.compileConfig = wago.NewRuntimeConfig().WithMaxModuleBytes(uint64(len(a.wasm)))';
 replace(config,config+`
\t\t\t\t\tif strings.HasPrefix(a.prep.Workload.ID, "features/threads/") || strings.HasPrefix(a.prep.Workload.HostProfile, "threads-") {
\t\t\t\t\t\ta.compileConfig = a.compileConfig.WithFeature(wago.CoreFeatureThreads, true)
\t\t\t\t\t}`);
 return source;
}
export async function applyWagoThreads(root,api){
 if(!api.includes('CoreFeatureThreads')||!api.includes('WithFeature('))return {policy:WAGO_THREADS_POLICY,available:false};
 const file=join(root,'adapters/wago/main.go'),before=await readFile(file,'utf8'),after=withWagoThreads(before);
 if(after!==before)await writeFile(file,after);
 return {policy:WAGO_THREADS_POLICY,available:true,scope:'threads feature workloads only; ordinary typed identity imports'};
}
