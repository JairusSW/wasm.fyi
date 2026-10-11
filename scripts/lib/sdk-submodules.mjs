import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';

// Older Git recursively enters optional update=none directories even though
// they have no .git. Inspect each level and recurse only into initialized pins.
export async function verifySDKSubmodules(source,paths,run,prefix='') {
 const declared=await readFile(join(source,'.gitmodules'),'utf8').catch(()=> '');
 const optional=new Set(declared.split(/(?=^\s*\[submodule\s)/m).filter(block=>/^\s*update\s*=\s*none\s*$/m.test(block)).map(block=>block.match(/^\s*path\s*=\s*(.+?)\s*$/m)?.[1]));
 const output=(await run('git',['submodule','status','--',...paths],{cwd:source})).output;
 const receipts=[];
 for(const line of output.split('\n').filter(line=>line.trim())) {
  const match=line.match(/^([ +\-U])([0-9a-f]{40})\s+(\S+)/);
  if(!match||['+','U'].includes(match[1]))throw Error('SDK submodule does not match its pinned gitlink: '+line);
  const [,state,revision,path]=match;
  const hasGit=Boolean(await stat(join(source,path,'.git')).catch(()=>null));
  if(state!=='-'&&!hasGit&&!optional.has(path))throw Error('Initialized SDK submodule has no Git metadata: '+path);
  const initialized=state!=='-'&&hasGit;
  if(!initialized&&!optional.has(path))throw Error('Required SDK submodule is not initialized: '+path);
  receipts.push({path:prefix+path,revision,initialized});
  if(!initialized)continue;
  const child=join(source,path),modules=await readFile(join(child,'.gitmodules'),'utf8').catch(error=>{
   if(error.code==='ENOENT')return '';throw error;
  });
  const nested=[...modules.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map(match=>match[1]);
  if(nested.length)receipts.push(...await verifySDKSubmodules(child,nested,run,prefix+path+'/'));
 }
 return receipts;
}
