import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {command} from './wasmbench.mjs';

export async function sourceContains(directory,pattern) {
 for(const entry of await readdir(directory,{withFileTypes:true})) {
  const path=join(directory,entry.name);
  if(entry.isDirectory()) {if(await sourceContains(path,pattern))return true;}
  else if(entry.name.endsWith('.rs')&&pattern.test(await readFile(path,'utf8')))return true;
 }
 return false;
}

export async function wagoArchitectureUnavailable(source,env=process.env) {
 let pkg;
 try {pkg=JSON.parse(command('go',['list','-e','-json','./src/core/runtime'],{cwd:source,env:{...env,GOWORK:'off'}}).toString());}
 catch {return null;}
 if(!pkg.Dir)return null;
 const declaresEngine=async file=>/\b(?:type\s+)?Engine\s+(?:struct\b|=)/.test(await readFile(join(pkg.Dir,file),'utf8'));
 for(const file of pkg.GoFiles||[])if(await declaresEngine(file))return null;
 for(const file of pkg.IgnoredGoFiles||[])if(await declaresEngine(file)) {
  const text=await readFile(join(pkg.Dir,file),'utf8');
  const constraint=text.match(/^\/\/go:build\s+([^\n]+)/m)?.[1];
  if(constraint)return {reason:'Pinned Wago runtime Engine is excluded by '+constraint,excludedFile:file,buildConstraint:constraint};
 }
 return null;
}
