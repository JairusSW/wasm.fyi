import {cp, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
// Node's clone-file flag is unavailable on Darwin; use the native APFS copier.
// Copy-on-write preserves independent writes without duplicating sealed data.
export async function cloneCopy(source,destination,options={}) {
  if(process.platform==='darwin') {
    await execute('/bin/cp',['-c',...(options.recursive?['-R']:[]),options.recursive?source+'/.':source,destination]);
  } else await cp(source,destination,{...options,mode:constants.COPYFILE_FICLONE});
}

// Batch known dataset filenames so large history refreshes avoid one process per file.
export async function cloneFiles(source,destination,names) {
  await mkdir(destination,{recursive:true});
  for(let i=0;i<names.length;i+=200) {
    const batch=names.slice(i,i+200);
    if(process.platform==='darwin')await execute('/bin/cp',['-c',...batch.map(name=>join(source,name)),destination]);
    else for(const name of batch)await cloneCopy(join(source,name),join(destination,name));
  }
}
