import { readFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { digest, site } from './wasmbench.mjs';

export async function applicationWorkloads(manifestPath, ids) {
  if(!manifestPath)return [];
  const path=resolve(site,manifestPath),root=dirname(path);
  const workloads=JSON.parse(await readFile(path,'utf8'));
  if(!Array.isArray(workloads)||!workloads.length)throw Error('Empty application manifest');
  const seen=new Set();
  const local=part=>{
    const full=resolve(root,part),rel=relative(root,full);
    if(isAbsolute(part)||rel.startsWith('..')||isAbsolute(rel))throw Error('Unsafe application path');
    return full;
  };
  for(const w of workloads) {
    if(!w.id?.startsWith('applications/')||seen.has(w.id))throw Error('Invalid application ID');seen.add(w.id);
    if(digest(await readFile(local(w.artifact)))!==w.sha256)throw Error(`Application artifact digest mismatch: ${w.id}`);
    const recipe=w.provenance?.recipe;
    if(!recipe||digest(await readFile(local(recipe.source)))!==recipe.sourceSha256)throw Error(`Application source digest mismatch: ${w.id}`);
    const oraclePath=resolve(site,recipe.oracleSource),rel=relative(site,oraclePath);
    if(rel.startsWith('..')||isAbsolute(rel)||digest(await readFile(oraclePath))!==recipe.oracleSha256)throw Error(`Application oracle digest mismatch: ${w.id}`);
    w.artifact=local(w.artifact);
  }
  if(ids?.some(id=>!seen.has(id))||ids&&new Set(ids).size!==ids.length)throw Error('Application override must select unique configured IDs');
  return ids?workloads.filter(w=>ids.includes(w.id)):workloads;
}
