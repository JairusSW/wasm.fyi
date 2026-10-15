import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

const oldConstructor='ExclusiveData(ExclusiveData&& rhs)\n      : lock_(std::move(rhs.lock)), value_(std::move(rhs.value_)) {';
const fixedConstructor=oldConstructor.replace('rhs.lock)', 'rhs.lock_)');

/** Opt-in build compatibility for an unused ESR115 constructor rejected by modern Clang. */
export async function repairSpiderMonkeyESR115(source,minimumRust,env,platform=process.platform){
 if(platform!=='linux'||minimumRust!=='1.66.0'||env.WASMFYI_SPIDERMONKEY_ESR115_MEMBER_FIX!=='1')return null;
 const path=join(source,'js/src/threading/ExclusiveData.h'),backup=path+'.wasmfyi-before';
 const current=await readFile(path,'utf8');
 let original=await readFile(backup,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(original===null){
  if(!current.includes(oldConstructor))return null; // Upstream already fixed, or another source cohort.
  if(current.split(oldConstructor).length!==2)throw Error('Ambiguous ESR115 ExclusiveData constructor');
  original=current;await writeFile(backup,original,{flag:'wx'});
 }
 if(original.split(oldConstructor).length!==2)throw Error('Original ESR115 ExclusiveData constructor differs');
 const corrected=original.replace(oldConstructor,fixedConstructor);
 if(current!==original&&current!==corrected)throw Error('ESR115 ExclusiveData header changed outside its qualified member fix');
 if(current!==corrected)await writeFile(path,corrected);
 return {path,originalSha256:digest(Buffer.from(original)),compiledSha256:digest(Buffer.from(corrected)),
  policy:'ESR115 move constructor names the lock_ data member instead of the lock() member function; opt-in source build compatibility'};
}
