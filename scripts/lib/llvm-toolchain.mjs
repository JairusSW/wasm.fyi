import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
export function wasmerLLVMVersion(manifest) {
 const values=[...manifest.matchAll(/"llvm(\d+)-(\d+)(?:-prefer-static|-force-static)?"/g)].map(m=>({major:Number(m[1]),minor:Number(m[2])}));
 if(values.length!==1)throw Error('Pinned Wasmer LLVM dependency does not identify one compiler ABI');
 return values[0];
}
export async function configureWasmerLLVM(source,env,run) {
 const version=wasmerLLVMVersion(await readFile(join(source,'lib/compiler-llvm/Cargo.toml'),'utf8'));
 const key=`LLVM_SYS_${version.major}${version.minor}_PREFIX`;
 const prefixes=[env[key],`/opt/homebrew/opt/llvm@${version.major}`,'/opt/homebrew/opt/llvm',`/usr/lib/llvm-${version.major}`].filter(Boolean);
 for(const prefix of prefixes) {
  const config=join(prefix,'bin/llvm-config');if(!await stat(config).catch(()=>null))continue;
  if(process.platform==='linux')env.LD_LIBRARY_PATH=join(prefix,'lib')+':'+(env.LD_LIBRARY_PATH||'');
  const actual=(await run(config,['--version'])).output.trim();
  if(!actual.startsWith(`${version.major}.${version.minor}.`))continue;
  env[key]=prefix;env.PATH=join(prefix,'bin')+':'+env.PATH;
  return {version:actual,prefix,environmentKey:key};
 }
 throw Error(`Pinned Wasmer LLVM backend requires LLVM ${version.major}.${version.minor}; install it or set ${key}. No substitute compiler backend will be used.`);
}
