import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export function withWasmiProposals(manifest,sdkManifest) {
 const features=['memory64','simd'].filter(name=>new RegExp('^'+name+'\\s*=','m').test(sdkManifest));
 const line=/^wasmi\s*=\s*\{[^\n]*\}/m.exec(manifest)?.[0];
 if(!line)throw Error('Wasmi dependency binding absent');
 const old=/features\s*=\s*\[([^\]]*)\]/.exec(line);
 if(!old)throw Error('Wasmi feature list absent');
 const current=[...old[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
 const available=name=>new RegExp('^'+name+'\\s*=','m').test(sdkManifest);
 const dispatch=available('auto-dispatch')?'auto-dispatch':available('portable-dispatch')?'portable-dispatch':null;
 const selected=dispatch?current.filter(name=>!['auto-dispatch','portable-dispatch','indirect-dispatch'].includes(name)):current;
 const next=[...new Set([...selected,...features,...(dispatch?[dispatch]:[])])];
 return manifest.replace(line,line.replace(old[0],'features = '+JSON.stringify(next)));
}
export async function applyWasmiProposals(root,sdk) {
 const path=join(root,'adapters/native/Cargo.toml'),before=await readFile(path,'utf8');
 const sdkManifest=await readFile(join(sdk,'Cargo.toml'),'utf8');
 const after=withWasmiProposals(before,sdkManifest);
 if(after!==before){await writeFile(path+'.before-feature-proposals',before);await writeFile(path,after);}
 const dependency=/^wasmi\s*=\s*\{[^\n]*\}/m.exec(after)?.[0]||'';
 const features=['memory64','simd'].filter(name=>new RegExp('"'+name+'"').test(dependency));
 const configSource=await readFile(join(sdk,'src/engine/config.rs'),'utf8').catch(()=> '');
 const featureSet=new Set([...dependency.matchAll(/"([^"]+)"/g)].map(match=>match[1]));
 const proposals=[
  ['wasm_memory64','memory64','memory64'],
  ['wasm_simd','simd','simd'],
  ['wasm_relaxed_simd','simd','relaxed-simd'],
  ['wasm_custom_page_sizes','validate','custom-page-sizes'],
  ['wasm_wide_arithmetic','validate','wide-arithmetic'],
 ].filter(([method,feature])=>featureSet.has(feature)&&configSource.includes('pub fn '+method+'('));
 const wasmConfigPath=join(root,'adapters/native/src/wasmi.rs');
 let wasmConfig=await readFile(wasmConfigPath,'utf8');
 const configAnchor='config.compilation_mode(CompilationMode::Eager);';
 if(!wasmConfig.includes(configAnchor))throw Error('Wasmi eager configuration seam absent');
 const calls=proposals.map(([method])=>`config.${method}(true);`);
 const missingCalls=calls.filter(call=>!wasmConfig.includes(call));
 if(missingCalls.length){
  wasmConfig=wasmConfig.replace(configAnchor,[configAnchor,...missingCalls].join('\n        '));
  await writeFile(wasmConfigPath+'.before-feature-proposals',await readFile(wasmConfigPath,'utf8'));
  await writeFile(wasmConfigPath,wasmConfig);
 }
 const mainPath=join(root,'adapters/native/src/main.rs'),main=await readFile(mainPath,'utf8');
 const dispatch=/"(auto-dispatch|portable-dispatch|indirect-dispatch)"/.exec(dependency)?.[1];
 if(!dispatch)throw Error('Wasmi dispatch configuration absent');
 const anchor=/"(?:portable|auto|indirect)-dispatch; eager bytecode; no fuel(?:; source-implemented proposals: [^"]*)?"/;
 const implemented=[...new Set([...features,...proposals.map(([, ,proposal])=>proposal)])];
 const policy=JSON.stringify(dispatch+'; eager bytecode; no fuel; source-implemented proposals: '+implemented.join(','));
 if(anchor.test(main)){await writeFile(mainPath+'.before-feature-proposals',main);await writeFile(mainPath,main.replace(anchor,policy));}
 else if(!main.includes(policy))throw Error('Wasmi effective configuration seam absent');
 return features;
}
