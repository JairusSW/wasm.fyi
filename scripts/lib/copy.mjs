import {cp} from 'node:fs/promises';
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
