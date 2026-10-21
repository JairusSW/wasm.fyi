import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
import {disableWazeroInterrupts} from './wazero-sampling.mjs';

const featureExpression='api.CoreFeaturesV2 | experimental.CoreFeaturesThreads | experimental.CoreFeaturesTailCall | experimental.CoreFeaturesExtendedConst | experimental.CoreFeaturesExceptionHandling | experimental.CoreFeaturesTypedFunctionReferences';

export function wazeroFeaturePolicySources({features,main,nativeCode,hosts=''}) {
 if(!features.includes('const enabledCoreFeatures =')) {
  features=features.replace('import "github.com/wasmbench/wasmbench/protocol"','import (\n\t"github.com/tetratelabs/wazero/api"\n\t"github.com/tetratelabs/wazero/experimental"\n\t"github.com/wasmbench/wasmbench/protocol"\n)\n\nconst enabledCoreFeatures = '+featureExpression);
  features=features
   .replace(/Evidence:\s+"[^"]+"/, 'Evidence:  "wazero public API: CoreFeaturesV2 plus every exposed experimental proposal bit; executable corpus probes remain authoritative"')
   .replace(/\n\s*\/\/ These experimental bits[\s\S]*?blanket declaration about every validator flag\./,'')
   .replace('"THREADS": false, "TAIL_CALL": false, "EXTENDED_CONST": false,','"THREADS": true, "TAIL_CALL": true, "EXTENDED_CONST": true,')
   .replace('"EXCEPTIONS": false, "FUNCTION_REFERENCES": false,','"EXCEPTIONS": true, "FUNCTION_REFERENCES": true,');
 }
 const replace=source=>disableWazeroInterrupts(source.replaceAll('WithCoreFeatures(api.CoreFeaturesV2)','WithCoreFeatures(enabledCoreFeatures)'));
 main=replace(main);nativeCode=replace(nativeCode);
 // The source-bound native-code helper used api.CoreFeaturesV2 only for its
 // runtime configuration. Once that expression moves to features.go, keeping
 // the import breaks recent Go toolchains as an unused dependency.
 if(!nativeCode.includes('api.'))nativeCode=nativeCode.replace(/^\s*"github\.com\/tetratelabs\/wazero\/api"\s*\n/m,'');
 if(hosts&&!hosts.includes('case "identity-v1", "threads-identity-v1", "threads-opaque-identity-v1":')){
  hosts=hosts.replace('case "identity-v1":','case "identity-v1", "threads-identity-v1", "threads-opaque-identity-v1":');
 }
 if(!main.includes('"can_host_profile_threads-identity-v1": true')){
  main=main.replace('Capabilities: map[string]bool{','Capabilities: map[string]bool{"can_host_profile_threads-identity-v1": true, "can_host_profile_threads-opaque-identity-v1": true, ');
 }
 main=main.replace('Features: []string{"mvp", "bulk-memory", "simd", "reference-types", "multi-value"}', 'Features: []string{"mvp", "bulk-memory", "simd", "reference-types", "multi-value", "threads", "tail-call", "extended-const", "exceptions", "typed-function-references"}');
 if(!features.includes('experimental.CoreFeaturesTypedFunctionReferences')||main.includes('WithCoreFeatures(api.CoreFeaturesV2)')||nativeCode.includes('WithCoreFeatures(api.CoreFeaturesV2)'))throw Error('Incomplete wazero feature policy');
 if(hosts&&!hosts.includes('"threads-opaque-identity-v1"'))throw Error('Incomplete wazero thread host-profile policy');
 return {features,main,nativeCode,hosts};
}

export async function applyWazeroFeaturePolicy(root) {
 const dir=join(root,'adapters/wazero'),paths={features:join(dir,'features.go'),main:join(dir,'main.go'),nativeCode:join(dir,'native_code.go'),hosts:join(dir,'hosts.go')},before={};
 for(const [name,path] of Object.entries(paths))before[name]=await readFile(path,'utf8');
 const after=wazeroFeaturePolicySources(before);
 for(const [name,path] of Object.entries(paths))if(after[name]!==before[name])await writeFile(path,after[name]);
 return {policy:'core-v2-plus-all-public-experimental-v1',filesSha256:Object.fromEntries(Object.entries(after).map(([name,value])=>[name,digest(Buffer.from(value))]))};
}
