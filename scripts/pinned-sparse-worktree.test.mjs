import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {preparePinnedSparseWorktree} from './lib/pinned-sparse-worktree.mjs';

test('missing linked-worktree sparse metadata is repaired only for the exact source pin',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pinned-sparse-')),source=join(root,'source'),checkout=join(root,'checkout');
 const run=(program,args)=>execFileSync(program,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const git=(cwd,...args)=>run('git',['-C',cwd,...args]).trim();
 try {
  await mkdir(source);git(source,'init');await mkdir(join(source,'keep'));await writeFile(join(source,'keep','file'),'source');
  await mkdir(join(source,'omit'));await writeFile(join(source,'omit','file'),'unneeded browser source');
  git(source,'add','.');git(source,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture');
  const revision=git(source,'rev-parse','HEAD');git(source,'worktree','add','--no-checkout','--detach',checkout,revision);
  assert.equal(await stat(join(checkout,'keep','file')).catch(()=>null),null);
  const info=dirname(resolve(checkout,git(checkout,'rev-parse','--git-path','info/sparse-checkout')));
  await rm(info,{recursive:true,force:true});
  await assert.rejects(preparePinnedSparseWorktree(checkout,'0'.repeat(40),run),/exact source pin/);
  assert.equal(await stat(info).catch(()=>null),null);
  git(checkout,'config','extensions.worktreeConfig','true');git(checkout,'config','--worktree','core.bare','true');
  await preparePinnedSparseWorktree(checkout,revision,run);assert.equal((await stat(info)).isDirectory(),true);
  assert.equal(git(checkout,'rev-parse','--is-bare-repository'),'false');
  assert.equal(git(source,'rev-parse','--is-bare-repository'),'false');
  git(checkout,'sparse-checkout','set','keep');git(checkout,'reset','--hard',revision);assert.equal(git(checkout,'rev-parse','HEAD'),revision);
  assert.equal((await stat(join(checkout,'keep','file'))).isFile(),true);
  assert.equal(await stat(join(checkout,'omit','file')).catch(()=>null),null);
 } finally {await rm(root,{recursive:true,force:true});}
});
