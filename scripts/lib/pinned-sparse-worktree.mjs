import {mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

// Older Git versions do not create a linked worktree's info directory before
// sparse-checkout set attempts to acquire its metadata lock.
export async function preparePinnedSparseWorktree(checkout,revision,run,env={}) {
 const actual=String(await run('git',['-C',checkout,'rev-parse','HEAD'],{env})).trim();
 if(!/^[0-9a-f]{40}$/.test(revision)||actual!==revision)throw Error('Sparse worktree differs from exact source pin');
 // Older Git inherits core.bare from a bare partial clone into linked trees.
 // Keep the object store bare while making this exact checkout usable.
 if(String(await run('git',['-C',checkout,'rev-parse','--is-bare-repository'],{env})).trim()==='true'){
  await run('git',['-C',checkout,'config','extensions.worktreeConfig','true'],{env});
  await run('git',['-C',checkout,'config','--worktree','core.bare','false'],{env});
 }
 const path=String(await run('git',['-C',checkout,'rev-parse','--git-path','info/sparse-checkout'],{env})).trim();
 if(!path)throw Error('Missing sparse worktree metadata path');
 await mkdir(dirname(resolve(checkout,path)),{recursive:true});
 return actual;
}
