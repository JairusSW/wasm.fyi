import { createHash,randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat,readdir,link,rename,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { exists,site } from './lib/wasmbench.mjs';

// Sealed source bundles remain at their original paths. Only byte-identical
// regular files with matching ownership/mode share storage; no evidence is
// pruned. Keep these archives immutable after deduplication.
const root=join(site,'.wasmbench/experiments');
async function experiments(directory,depth=0) {
  const found=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(!entry.isDirectory())continue;
    const path=join(directory,entry.name);
    if(await exists(join(path,'report/checksums.json')))found.push(path);
    else if(depth===0&&/^hub-\d{4}-\d{2}-\d{2}T/.test(entry.name)&&await exists(join(path,'experiments')))found.push(...await experiments(join(path,'experiments'),1));
  }
  return found;
}
async function* files(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory())yield* files(path);
    else if(entry.isFile())yield path;
  }
}
async function sha(path) {const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
const seen=new Map(),inodes=new Set();let count=0,reclaimed=0;
if(await exists(root))for(const experiment of await experiments(root))for await(const path of files(experiment)) {
  const before=await lstat(path),inode=`${before.dev}|${before.ino}`;
  if(before.size<1024*1024||inodes.has(inode))continue;
  inodes.add(inode);
  const hash=await sha(path),after=await lstat(path);
  if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('Archive changed while deduplicating: '+path);
  const key=[before.dev,before.size,before.mode,before.uid,before.gid,hash].join('|');
  if(!seen.has(key)){seen.set(key,path);continue;}
  const temporary=path+'.deduplicate-'+randomUUID();
  try {await link(seen.get(key),temporary);await rename(temporary,path);}
  finally {await rm(temporary,{force:true});}
  if(before.nlink===1)reclaimed+=before.blocks*512;
  count++;
}
console.log(`Identical archived files linked: ${count}; allocated bytes reclaimed: ${reclaimed}. All evidence paths and contents are retained.`);
