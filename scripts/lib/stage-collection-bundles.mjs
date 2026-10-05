import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyParentBundle} from './benchmark-bundle.mjs';
import {digest,site} from './wasmbench.mjs';
const exec=promisify(execFile);

// Only committed, byte-identical manifests may point at immutable GitHub assets.
export async function committedArchiveLocation(){
 try{
  const revision=(await exec('git',['rev-parse','HEAD'],{cwd:site})).stdout.trim();
  const origin=(await exec('git',['remote','get-url','origin'],{cwd:site})).stdout.trim();
  const repository=origin.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
  if(!repository || !/^[a-f0-9]{40}$/.test(revision))return {};
  return {archiveBaseUrl:`https://raw.githubusercontent.com/${repository}/${revision}/data/benchmark-runs/`,
   committed:async(path,bytes)=>{
    try{return (await exec('git',['show',`${revision}:data/benchmark-runs/${path}`],{cwd:site,encoding:'buffer',maxBuffer:8*1024*1024})).stdout.equals(bytes);}catch{return false;}
   }};
 }catch{return {};}
}

export async function stageCollectionBundles(source,destination,{archiveBaseUrl,committed=async()=>false}={}){
 async function walk(folder){
  const entries=await readdir(folder,{withFileTypes:true});
  const output=join(destination,relative(source,folder));await mkdir(output,{recursive:true});
  if(entries.some(e=>e.isFile()&&e.name==='index.json') && entries.some(e=>e.name.startsWith('bundle.tar.gz.part-'))){
   const original=await readFile(join(folder,'index.json')),index=JSON.parse(original);
   const metadata=JSON.parse(await readFile(join(folder,index.metadata)));
   await verifyParentBundle(folder,{id:index.id,identity:metadata.planSha256});
   const path=relative(source,join(folder,'index.json'));
   if(archiveBaseUrl && await committed(path,original)){
    const base=new URL(relative(source,folder).split('/').map(encodeURIComponent).join('/')+'/',archiveBaseUrl);
    const projected={...index,parts:index.parts.map(p=>({...p,url:new URL(p.path,base).href})),sourceIndex:'source-index.json',sourceIndexSha256:digest(original),
     download:'Download each part from its immutable url in order, concatenate, verify the full SHA-256, then tar -xzf bundle.tar.gz. The original sealed index is retained as source-index.json.'};
    await writeFile(join(output,'index.json'),JSON.stringify(projected,null,2)+'\n');
    await writeFile(join(output,'source-index.json'),original);
    for(const entry of entries)if(entry.name!=='index.json'&&!index.parts.some(p=>p.path===entry.name))await cp(join(folder,entry.name),join(output,entry.name),{recursive:entry.isDirectory()});
    return;
   }
  }
  for(const entry of entries){const path=join(folder,entry.name);if(entry.isDirectory())await walk(path);else await cp(path,join(output,entry.name));}
 }
 await walk(source);
}
