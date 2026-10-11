import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

// CMake discards first-invocation flags when an existing compiler changes.
// Reapply the complete configure command and fail closed if policy is lost.
export async function configureCMakeSource({source,target,flags,run,options={}}) {
 const expected=new Map();
 for(const flag of flags)if(/^-DCMAKE_(?:C_FLAGS|CXX_FLAGS|EXE_LINKER_FLAGS|SHARED_LINKER_FLAGS|MODULE_LINKER_FLAGS)=/.test(flag)){
  const split=flag.indexOf('=');expected.set(flag.slice(2,split),flag.slice(split+1));
 }
 const configure=()=>run('cmake',['-S',source,'-B',target,...flags],options);
 const matches=async()=>{
  if(!expected.size)return true;
  const cache=(await readFile(join(target,'CMakeCache.txt'),'utf8')).split('\n');
  return [...expected].every(([key,value])=>cache.includes(key+':STRING='+value));
 };
 const compilers=new Map();
 for(const flag of flags)if(/^-DCMAKE_(?:C|CXX)_COMPILER=/.test(flag)){
  const split=flag.indexOf('=');compilers.set(flag.slice(2,split),flag.slice(split+1));
 }
 const cachedCompilers=async()=>{
  let text;try{text=await readFile(join(target,'CMakeCache.txt'),'utf8')}catch(error){if(error.code==='ENOENT')return null;throw error}
  const values=new Map();for(const line of text.split('\n')){const match=line.match(/^(CMAKE_(?:C|CXX)_COMPILER):[^=]+=(.*)$/);if(match)values.set(match[1],match[2]);}return values;
 };
 const before=await cachedCompilers();let replayed=false;
 try{await configure()}catch(error){
  const after=await cachedCompilers();
  const migrated=before&&after&&[...compilers].some(([key,value])=>before.has(key)&&before.get(key)!==value&&after.get(key)===value);
  // A compiler change can rerun configure with the requested flags removed,
  // causing an ABI/feature probe to fail before the normal replay step.
  if(!migrated||!expected.size||await matches())throw error;
  await configure();replayed=true;
 }
 if(!await matches()&&!replayed)await configure();
 if(!await matches())throw Error('CMake discarded required compiler/link policy in '+target);
}
