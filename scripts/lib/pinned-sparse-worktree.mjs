import {mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

// Older Git versions do not create a linked worktree's info directory before
// sparse-checkout set attempts to acquire its metadata lock.
export async function preparePinnedSparseWorktree(checkout,revision,run,env={}) {
 const actual=String(await run('git',['-C',checkout,'rev-parse','HEAD'],{env})).trim();
 if(!/^[0-9a-f]{40}$/.test(revision)||actual!==revision)throw Error('Sparse worktree differs from exact source pin');
 const path=String(await run('git',['-C',checkout,'rev-parse','--git-path','info/sparse-checkout'],{env})).trim();
 if(!path)throw Error('Missing sparse worktree metadata path');
 await mkdir(dirname(resolve(checkout,path)),{recursive:true});
 return actual;
}
