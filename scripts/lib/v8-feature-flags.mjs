import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const v8DeclaredFeatureFlags=Object.freeze([
 '--experimental-wasm-branch-hinting',
 '--experimental-wasm-compilation-hints',
]);
export const V8_FEATURE_FLAG_POLICY='workload-scoped-v3';

const v8FlagPolicyMarker='// wasm-fyi workload-scoped V8 proposal flags v2';
const v8FlagPolicyMarkerV1='// wasm-fyi workload-scoped V8 proposal flags v1';
const runnerAllowed='\t\t\tallowedFeatureFlags := map[string]bool{"--experimental-wasm-branch-hinting":true,"--experimental-wasm-compilation-hints":true,"--experimental-wasm-jspi":true,"--experimental-wasm-wasmfx":true,"--experimental-wasm-instruction-tracing":true,"--experimental-wasm-shared":true,"--experimental-wasm-fp16":true,"--experimental-wasm-memory-control":true,"--experimental-wasm-stringref":true,"--experimental-wasm-custom-descriptors":true}';
const compilerAllowed="  const allowedFeatureFlags=new Set(['--experimental-wasm-branch-hinting','--experimental-wasm-compilation-hints','--experimental-wasm-jspi','--experimental-wasm-wasmfx','--experimental-wasm-instruction-tracing','--experimental-wasm-shared','--experimental-wasm-fp16','--experimental-wasm-memory-control','--experimental-wasm-stringref','--experimental-wasm-custom-descriptors']);";

const workloadFlags=Object.freeze({
 jspi:'--experimental-wasm-jspi',
 'stack-switching':'--experimental-wasm-wasmfx',
 'instrument-and-tracing-technology':'--experimental-wasm-instruction-tracing',
 'shared-everything-threads':'--experimental-wasm-shared',
 'half-precision':'--experimental-wasm-fp16',
 'memory-control':'--experimental-wasm-memory-control',
 stringref:'--experimental-wasm-stringref',
 'custom-descriptors':'--experimental-wasm-custom-descriptors',
});

export function v8FlagsForWorkload(workload){
 const feature=String(workload?.id||workload||'').split('/')[1];
 return [...v8DeclaredFeatureFlags,...(workloadFlags[feature]?[workloadFlags[feature]]:[])];
}

export function withV8FeatureFlagRunner(source){
 const marker=v8FlagPolicyMarker;
 if(source.includes(marker))return source;
 if(source.includes(v8FlagPolicyMarkerV1)){
  const matches=source.match(/^\t\t\tallowedFeatureFlags := map\[string\]bool\{.*\}$/gm)||[];
  if(matches.length!==1)throw Error('V8 proposal flag runner v1 policy changed');
  return source.replace(v8FlagPolicyMarkerV1,marker).replace(matches[0],runnerAllowed);
 }
 const anchor='\t\t\tr.Command = append(r.Command, filepath.Join(root, "adapters", "v8", "adapter.mjs"))';
 if(!source.includes(anchor))throw Error('V8 proposal flag runner seam changed');
 return source.replace(anchor,`${marker}\n\t\t\tfeatureFlags := strings.Fields(os.Getenv("WASMBENCH_V8_FEATURE_FLAGS"))\n\t\t\tallowedFeatureFlags := map[string]bool{"--experimental-wasm-branch-hinting":true,"--experimental-wasm-compilation-hints":true,"--experimental-wasm-jspi":true,"--experimental-wasm-wasmfx":true,"--experimental-wasm-instruction-tracing":true,"--experimental-wasm-shared":true,"--experimental-wasm-fp16":true,"--experimental-wasm-memory-control":true,"--experimental-wasm-stringref":true,"--experimental-wasm-custom-descriptors":true}\n\t\t\tfor _, featureFlag := range featureFlags {\n\t\t\t\tif !allowedFeatureFlags[featureFlag] { return nil, fmt.Errorf("invalid WASMBENCH_V8_FEATURE_FLAGS entry %q", featureFlag) }\n\t\t\t\tr.Command = append(r.Command, featureFlag)\n\t\t\t}\n${anchor}`);
}

export function withV8FeatureFlagCompilerMode(source){
 const marker=v8FlagPolicyMarker;
 if(source.includes(marker))return source;
 if(source.includes(v8FlagPolicyMarkerV1)){
  const matches=source.match(/^  const allowedFeatureFlags=new Set\(\[.*\]\);$/gm)||[];
  if(matches.length!==1)throw Error('V8 proposal flag compiler-mode v1 policy changed');
  return source.replace(v8FlagPolicyMarkerV1,marker).replace(matches[0],compilerAllowed);
 }
 const anchor="  const mode=argv[0].slice('--compiler-mode='.length),expected=compilerModeFlags[mode];";
 if(!source.includes(anchor))throw Error('V8 proposal flag compiler-mode seam changed');
 return source.replace(anchor,`${marker}\n  const allowedFeatureFlags=new Set(['--experimental-wasm-branch-hinting','--experimental-wasm-compilation-hints','--experimental-wasm-jspi','--experimental-wasm-wasmfx','--experimental-wasm-instruction-tracing','--experimental-wasm-shared','--experimental-wasm-fp16','--experimental-wasm-memory-control','--experimental-wasm-stringref','--experimental-wasm-custom-descriptors']);\n  flags=flags.filter(flag=>!allowedFeatureFlags.has(flag));\n${anchor}`);
}

export function withV8FeatureFlagNativeSize(source){
 const marker=v8FlagPolicyMarker;
 if(source.includes(marker))return source;
 if(source.includes(v8FlagPolicyMarkerV1))return source.replace(v8FlagPolicyMarkerV1,marker);
 const anchor=" return [\"--single-threaded\",\"--single-threaded-gc\",\"--wasm-num-compilation-tasks=0\"].concat(['--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation',...(process.env.WASMBENCH_V8_TURBOSHAFT_POLICY==='explicit-flag'?['--turboshaft-wasm']:[]),selected]);";
 if(!source.includes(anchor))throw Error('V8 proposal flag native-size seam changed');
 return source.replace(anchor,`${marker}\n const featureFlags=process.execArgv.filter(flag=>flag.startsWith('--experimental-wasm-'));\n${anchor.replace('selected]);','selected,...featureFlags]);')}`);
}

export async function applyV8FeatureFlags(root){
 const files=[
  ['experiment/runner.go',withV8FeatureFlagRunner],
  ['adapters/v8/compiler-mode.mjs',withV8FeatureFlagCompilerMode],
  ['adapters/v8/native-size.mjs',withV8FeatureFlagNativeSize],
 ];
 let changed=false;
 for(const [relative,transform] of files){const file=join(root,relative),before=await readFile(file,'utf8'),after=transform(before);if(after!==before){await writeFile(file,after);changed=true}}
 return changed;
}
