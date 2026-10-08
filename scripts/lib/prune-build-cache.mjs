import {readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
// Rust's final binaries and runtime SDK libraries remain in place. Intermediate
// object files are unnecessary once a source-specific build receipt is sealed.
export async function pruneRustIntermediates(harness) {
 const roots=[join(harness,'adapters/wasmtime/target'),join(harness,'adapters/native/target')];
 async function visit(path) {
  for(const entry of await readdir(path,{withFileTypes:true}).catch(()=>[])) {
   if(!entry.isDirectory()||entry.isSymbolicLink())continue;
   const child=join(path,entry.name);
   if(entry.name==='release')for(const name of ['deps','build','.fingerprint','incremental'])await rm(join(child,name),{recursive:true,force:true});
   else if(!['debug','incremental'].includes(entry.name))await visit(child);
  }
 }
 for(const path of roots)await visit(path);
}
