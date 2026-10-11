import {stat} from 'node:fs/promises';
// Reuse only an executable in the caller's exact source-pin cache directory.
export async function reusablePinnedExecutable(file,revision,sourceRevision){
 if(!/^[a-f0-9]{40}$/.test(revision)||sourceRevision!==revision)return false;
 const value=await stat(file).catch(()=>null);
 return Boolean(value?.isFile()&&value.size>0&&(value.mode&0o111));
}
