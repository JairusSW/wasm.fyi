import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

const feature='("SHARED_EVERYTHING_THREADS", WasmFeatures::SHARED_EVERYTHING_THREADS, !winch),';
const configure='    config.wasm_shared_everything_threads(!winch);';

function once(source,before,after,name){
 if(source.split(before).length!==2)throw Error('Wasmtime feature-policy seam changed: '+name);
 return source.replace(before,after);
}

export function withWasmtimeDeclaredFeatures(source){
 if(source.includes(feature)&&source.includes(configure))return {source,alreadyApplied:true};
 if(source.includes(feature)||source.includes(configure))throw Error('Partial Wasmtime shared-everything policy');
 source=once(source,
  '        ("WIDE_ARITHMETIC", WasmFeatures::WIDE_ARITHMETIC, !winch || cfg!(target_arch = "x86_64")),',
  '        ("WIDE_ARITHMETIC", WasmFeatures::WIDE_ARITHMETIC, !winch || cfg!(target_arch = "x86_64")),\n        '+feature,
  'feature declaration');
 source=once(source,
  '    config.wasm_branch_hinting(!winch);',
  '    config.wasm_branch_hinting(!winch);\n'+configure,
  'engine configuration');
 source=once(source,
  'threads, GC runtime support and shared memories;',
  'threads, shared-everything threads, GC runtime support and shared memories;',
  'declared support evidence');
 source=once(source,
  '            assert_eq!(describe(winch)["supported"]["THREADS"], json!(!winch || cfg!(target_arch = "x86_64")));',
  '            assert_eq!(describe(winch)["supported"]["THREADS"], json!(!winch || cfg!(target_arch = "x86_64")));\n            assert_eq!(describe(winch)["supported"]["SHARED_EVERYTHING_THREADS"], json!(!winch));',
  'policy assertion');
 return {source,alreadyApplied:false};
}

export async function applyWasmtimeDeclaredFeatures(root){
 const path=join(root,'adapters/wasmtime/src/features.rs'),before=await readFile(path,'utf8');
 const result=withWasmtimeDeclaredFeatures(before);
 if(result.source!==before)await writeFile(path,result.source);
 return {...result,source:undefined,beforeSha256:digest(Buffer.from(before)),afterSha256:digest(Buffer.from(result.source))};
}
