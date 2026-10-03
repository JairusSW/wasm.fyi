// Explicitly re-pin retained editable inputs after an intentional local edit.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { site, digest } from './lib/wasmbench.mjs';
const path=join(site,'corpora/upstream/sources.json');
const lock=JSON.parse(await readFile(path));
const refresh=process.argv.includes('--refresh');
const root=join(site,'corpora/upstream/wago');
if(refresh) {
  const files=[];
  async function walk(part='') {
    for(const entry of await readdir(join(root,part),{withFileTypes:true})) {
      if(entry.name.startsWith('.')||entry.name==='node_modules'||entry.name.endsWith('.wasm'))continue;
      const path=join(part,entry.name);
      if(entry.isDirectory())await walk(path);
      else if(entry.isFile())files.push({path,sha256:digest(await readFile(join(root,path)))});
    }
  }
  await walk();
  const previous=new Map(lock.files.map(file=>[file.path,file.sha256]));
  for(const file of files)if(previous.get(file.path)!==file.sha256)console.log(previous.has(file.path)?'Re-pinned':'Added',file.path);
  for(const file of lock.files)if(!files.some(candidate=>candidate.path===file.path))console.log('Removed',file.path);
  lock.files=files.sort((a,b)=>a.path.localeCompare(b.path));
  await writeFile(path,JSON.stringify(lock,null,2)+'\n');
} else for(const file of lock.files) {
  const actual=digest(await readFile(join(root,file.path)));
  if(actual!==file.sha256)throw Error('Changed source input: '+file.path+'; use --refresh after reviewing your edit');
}
console.log('Retained source input digests verified');
