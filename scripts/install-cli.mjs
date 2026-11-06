// Source installation: no production databases, credentials or benchmark caches.
import {mkdir,cp,rm,rename,stat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const prefix=resolve(process.argv[2]||join(homedir(),'.local'));
const assets=join(prefix,'share','wasmfyi'),stage=assets+'.install-'+process.pid;
if(prefix===root||assets.startsWith(root+'/'))throw Error('Choose an installation prefix outside the checkout');
try{
 execFileSync('pnpm',['build'],{cwd:root,stdio:'inherit'});
 await mkdir(stage,{recursive:true});
 for(const name of ['scripts','schemas','adapters','patches','corpora','build'])await cp(join(root,name),join(stage,name),{recursive:true,filter:p=>!p.split('/').some(x=>['node_modules','.git','target','.tmp','__pycache__'].includes(x))});
 for(const name of ['wasmbench.config.json','LICENSE'])if(await stat(join(root,name)).catch(()=>null))await cp(join(root,name),join(stage,name));
 await mkdir(join(prefix,'bin'),{recursive:true});
 const binary=join(prefix,'bin','wasmfyi.install-'+process.pid);
 execFileSync('go',['build','-trimpath','-o',binary,'./cmd/wasmfyi'],{cwd:join(root,'service'),stdio:'inherit'});
 // Only replace installed program assets; user results live elsewhere.
 await rm(assets,{recursive:true,force:true});await rename(stage,assets);await rename(binary,join(prefix,'bin','wasmfyi'));
 process.stdout.write(`\nInstalled ${join(prefix,'bin','wasmfyi')}\nAdd ${join(prefix,'bin')} to PATH, then run wasmfyi doctor.\n`);
}finally{await rm(stage,{recursive:true,force:true})}
