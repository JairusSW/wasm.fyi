import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

function withStackSwitchingPolicy(source){
 const pattern=/^const validatorFeatures = [^\n]+;$/gm;
 const matches=[...source.matchAll(pattern)];
 if(matches.length!==1)throw Error('V8 feature coverage validator policy changed');
 return source.replace(pattern,match=>match+'\nvalidatorFeatures.supported.STACK_SWITCHING=true;');
}

// Representative valid binaries establish decoder support under the actual Node flags.
// The controller only excludes a workload when its independent validator says the
// corresponding proposal is required, so ordinary compact-import controls still run.
export function withV8FeatureCoverage(source,probes,{stackSwitching=false}={}){
 const marker='// wasm-fyi V8 feature coverage v2',legacy='// wasm-fyi V8 feature coverage v1';
 if(source.includes(marker))return source;
 if(source.includes(legacy)){
  if(!stackSwitching)return source;
  return withStackSwitchingPolicy(source.replace(legacy,marker));
 }
 const probeAnchor='const validatorFeatures =';
 const declarationAnchor='const validatorFeatures = {namespace:';
 const profileAnchor="'can_host_profile_threads-defined-v1':true,";
 const bindAnchor="if(prep.workload.host_profile==='identity-v1')";
 for(const anchor of [probeAnchor,declarationAnchor,profileAnchor,bindAnchor])if(!source.includes(anchor))throw Error('V8 feature coverage seam changed: '+anchor);
 const allowAnchor=source.match(/'threads-defined-v1'(?:,'threads-identity-v1')?(?:,'threads-opaque-identity-v1')?,'wasi-preview1-readonly-v1'/)?.[0];
 if(!allowAnchor)throw Error("V8 feature coverage seam changed: threads host-profile allowlist");
 for(const key of ['COMPACT_IMPORTS','WIDE_ARITHMETIC'])if(typeof probes[key]!=='string'||!probes[key])throw Error('Missing V8 feature probe: '+key);
 let result=source.replace(probeAnchor,`${marker}\nObject.assign(featureProbes,${JSON.stringify(probes)});\n${probeAnchor}`)
  .replace(declarationAnchor,`const validatorFeatures = {branch_hinting:process.execArgv.includes('--experimental-wasm-branch-hinting'),compilation_hints:process.execArgv.includes('--experimental-wasm-compilation-hints'),namespace:`)
  .replace(allowAnchor,"'threads-defined-v1','threads-identity-v1','threads-opaque-identity-v1','wasi-preview1-readonly-v1'")
  .replace(bindAnchor,"if(['identity-v1','threads-identity-v1','threads-opaque-identity-v1'].includes(prep.workload.host_profile))");
 if(stackSwitching)result=withStackSwitchingPolicy(result);
 if(result.includes("'can_host_profile_threads-opaque-identity-v1':true,"))return result;
 const identityCapability="'can_host_profile_threads-identity-v1':true,";
 if(result.includes(identityCapability))return result.replace(identityCapability,identityCapability+"'can_host_profile_threads-opaque-identity-v1':true,");
 return result.replace(profileAnchor,profileAnchor+identityCapability+"'can_host_profile_threads-opaque-identity-v1':true,");
}
export async function applyV8FeatureCoverage(root,coverage={}){
 const artifacts=new URL('../../corpora/features/artifacts/',import.meta.url);
 const probes={};
 for(const [key,file] of [['COMPACT_IMPORTS','compact-imports-module-group.wasm'],['WIDE_ARITHMETIC','wide-arithmetic-add128.wasm']])probes[key]=(await readFile(new URL(file,artifacts))).toString('base64');
 const file=join(root,'adapters/v8/adapter.mjs'),before=await readFile(file,'utf8'),after=withV8FeatureCoverage(before,probes,coverage);
 if(before!==after)await writeFile(file,after);
 return before!==after;
}
