import {readFile,stat,mkdir,writeFile,chmod,symlink} from 'node:fs/promises';
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
  const systemLibraries=(await run(config,['--system-libs','--link-static'])).output.trim();
  let buildPrefix=prefix;
  if(systemLibraries.split(/\s+/).some(flag=>flag.startsWith('/')&&flag.endsWith('.a'))){
   // llvm-sys accepts -l names, but rejects LLVM's absolute static-library spelling.
   buildPrefix=join(source,'..',`llvm-config-${version.major}-${version.minor}`);
   await mkdir(join(buildPrefix,'bin'),{recursive:true});
   const wrapper=join(buildPrefix,'bin/llvm-config');
   await writeFile(wrapper,'#!/usr/bin/env python3\nimport subprocess,sys,pathlib\np=subprocess.run(['+JSON.stringify(config)+']+sys.argv[1:],stdout=subprocess.PIPE)\ns=p.stdout.decode()\nif "--system-libs" in sys.argv:\n s=" ".join("-l"+pathlib.Path(x).name[3:-2] if x.startswith("/") and pathlib.Path(x).name.startswith("lib") and x.endswith(".a") else x for x in s.split())+"\\n"\nsys.stdout.write(s)\nsys.exit(p.returncode)\n');
   await chmod(wrapper,0o755);
   for(const name of ['lib','include'])if(!await stat(join(buildPrefix,name)).catch(()=>null))await symlink(join(prefix,name),join(buildPrefix,name));
  }
  env[key]=buildPrefix;env.PATH=join(buildPrefix,'bin')+':'+env.PATH;
  return {version:actual,prefix,buildPrefix,environmentKey:key};
 }
 throw Error(`Pinned Wasmer LLVM backend requires LLVM ${version.major}.${version.minor}; install it or set ${key}. No substitute compiler backend will be used.`);
}
