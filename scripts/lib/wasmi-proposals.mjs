import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export function withWasmiProposals(manifest,sdkManifest) {
 const features=['memory64','simd'].filter(name=>new RegExp('^'+name+'\\s*=','m').test(sdkManifest));
 const line=/^wasmi\s*=\s*\{[^\n]*\}/m.exec(manifest)?.[0];
 if(!line)throw Error('Wasmi dependency binding absent');
 const old=/features\s*=\s*\[([^\]]*)\]/.exec(line);
 if(!old)throw Error('Wasmi feature list absent');
 const current=[...old[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
 const next=[...new Set([...current,...features])];
 return manifest.replace(line,line.replace(old[0],'features = '+JSON.stringify(next)));
}
export async function applyWasmiProposals(root,sdk) {
 const path=join(root,'adapters/native/Cargo.toml'),before=await readFile(path,'utf8');
 const after=withWasmiProposals(before,await readFile(join(sdk,'Cargo.toml'),'utf8'));
 if(after!==before){await writeFile(path+'.before-feature-proposals',before);await writeFile(path,after);}
 const dependency=/^wasmi\s*=\s*\{[^\n]*\}/m.exec(after)?.[0]||'';
 const features=['memory64','simd'].filter(name=>new RegExp('"'+name+'"').test(dependency));
 const mainPath=join(root,'adapters/native/src/main.rs'),main=await readFile(mainPath,'utf8');
 const anchor='"portable-dispatch; eager bytecode; no fuel"';
 const policy=JSON.stringify('portable-dispatch; eager bytecode; no fuel; source-implemented proposals: '+features.join(','));
 if(main.includes(anchor)){await writeFile(mainPath+'.before-feature-proposals',main);await writeFile(mainPath,main.replace(anchor,policy));}
 else if(!main.includes(policy))throw Error('Wasmi effective configuration seam absent');
 return features;
}
