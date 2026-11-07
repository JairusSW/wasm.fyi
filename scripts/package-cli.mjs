// Package only public program assets. Databases, credentials, dumps and private
// homepage-maintenance programs must never enter a downloadable CLI bundle.
import {cp,mkdir,rm,mkdtemp,lstat} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
const output=resolve(process.argv[2]||'.wasmfyi/cli/assets.tar.gz');
await mkdir(resolve(output,'..'),{recursive:true});
const stage=await mkdtemp(join(resolve(output,'..'),'.assets-'));
try{
 const root=join(stage,'share','wasmfyi');await mkdir(root,{recursive:true});
 for(const name of ['scripts','schemas','adapters','patches','corpora','build'])await cp(resolve(name),join(root,name),{recursive:true,filter:async path=>{
  const parts=path.split('/');if(parts.some(p=>['.git','node_modules','target','__pycache__'].includes(p)))return false;
  const file=basename(path);if(file.startsWith('.')||file.endsWith('.wasm')||file.endsWith('.sqlite')||file.endsWith('.env')||file.endsWith('.log'))return false;
  return !(await lstat(path)).isSymbolicLink();
 }});
 await cp(resolve('wasmbench.config.json'),join(root,'wasmbench.config.json'));
 for(const name of ['LICENSE','LICENSE.md'])if(await lstat(resolve(name)).catch(()=>null))await cp(resolve(name),join(root,name));
 execFileSync('tar',['-czf',output,'-C',stage,'share'],{stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'}});
 console.log('Packaged public CLI assets:',output);
}finally{await rm(stage,{recursive:true,force:true})}
