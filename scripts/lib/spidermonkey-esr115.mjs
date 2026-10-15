import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

const oldConstructor='ExclusiveData(ExclusiveData&& rhs)\n      : lock_(std::move(rhs.lock)), value_(std::move(rhs.value_)) {';
const oldMoves=oldConstructor+'\n    MOZ_ASSERT(&rhs != this, "self-move disallowed!");\n  }\n\n  ExclusiveData& operator=(ExclusiveData&& rhs) {\n    this->~ExclusiveData();\n    new (mozilla::KnownNotNull, this) ExclusiveData(std::move(rhs));\n    return *this;\n  }';
const fixedMoves='ExclusiveData(ExclusiveData&&) = delete;\n  ExclusiveData& operator=(ExclusiveData&&) = delete;';

/** Mutex is non-movable; ESR115's unusable move bodies fail modern Clang even when unused. */
export async function repairSpiderMonkeyESR115(source,minimumRust,env,platform=process.platform){
 if(platform!=='linux'||minimumRust!=='1.66.0'||env.WASMFYI_SPIDERMONKEY_ESR115_MOVE_FIX!=='1')return null;
 const path=join(source,'js/src/threading/ExclusiveData.h'),backup=path+'.wasmfyi-before';
 const current=await readFile(path,'utf8');
 let original=await readFile(backup,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(original===null){
  if(!current.includes(oldMoves))return null; // Upstream already fixed, or another source cohort.
  if(current.split(oldMoves).length!==2)throw Error('Ambiguous ESR115 ExclusiveData move operations');
  original=current;await writeFile(backup,original,{flag:'wx'});
 }
 if(original.split(oldMoves).length!==2)throw Error('Original ESR115 ExclusiveData move operations differ');
 const corrected=original.replace(oldMoves,fixedMoves);
 // Accept the prior qualified member-name attempt only with its original backup.
 // The full SDK build proved that Mutex itself cannot be moved either.
 const memberAttempt=original.replace(oldConstructor,oldConstructor.replace('rhs.lock)', 'rhs.lock_)'));
 if(current!==original&&current!==corrected&&current!==memberAttempt)throw Error('ESR115 ExclusiveData header changed outside its qualified move fix');
 if(current!==corrected)await writeFile(path,corrected);
 return {path,originalSha256:digest(Buffer.from(original)),compiledSha256:digest(Buffer.from(corrected)),
  policy:'ESR115 explicitly deletes unused move operations that cannot move its non-movable Mutex; opt-in source build compatibility'};
}
