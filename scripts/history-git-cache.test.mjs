import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {hasPinnedCommit} from './lib/history-git-cache.mjs';

test('cached source pins require the exact full commit object', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-git-cache-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init');
    await writeFile(join(root, 'source.txt'), 'pinned source\n');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'fixture');
    const commit = git('rev-parse', 'HEAD');
    const tree = git('rev-parse', 'HEAD^{tree}');
    const blob = git('rev-parse', 'HEAD:source.txt');
    git('tag', 'v1');
    assert.equal(await hasPinnedCommit(root, commit), true);
    for (const invalid of [commit.slice(0,12), 'HEAD', 'v1', tree, blob, '0'.repeat(40), undefined]) {
      assert.equal(await hasPinnedCommit(root, invalid), false, String(invalid));
    }
    assert.equal(await hasPinnedCommit(join(root, 'missing'), commit), false);
  } finally {
    await rm(root, {recursive:true, force:true});
  }
});

// Exercise the production Libwasm fetch branch with real local Git objects.
test('Libwasm skips cached pins and fetches missing exact commits', async () => {
 const root=await mkdtemp(join(tmpdir(),'libwasm-cache-'));
 const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try {
  const origin=join(root,'origin'),source=join(root,'source');
  execFileSync('git',['init',origin],{stdio:'ignore'});
  await writeFile(join(origin,'source.txt'),'source fixture');git(origin,'add','.');git(origin,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture');
  const revision=git(origin,'rev-parse','HEAD');
  execFileSync('git',['init',source],{stdio:'ignore'});git(source,'remote','add','origin',origin);
  const recipe=await readFile(new URL('./benchmark-libwasm-history.mjs',import.meta.url),'utf8');
  const branch=recipe.split('\n').find(line=>line.includes("source,'fetch'"));
  assert.match(branch,/if\(!await hasPinnedCommit\(source,pin\.revision\)\)/);
  assert.match(recipe,/if\(actualRevision!==pin\.revision\)throw Error/);
  const execute=new (Object.getPrototypeOf(async function(){}).constructor)('hasPinnedCommit','command','source','pin','env',branch);
  let fetches=0;const command=(program,args)=>{assert.equal(program,'git');fetches++;return execFileSync(program,args,{stdio:'ignore'});};
  assert.equal(await hasPinnedCommit(source,revision),false);
  await execute(hasPinnedCommit,command,source,{revision},{});
  assert.equal(fetches,1);assert.equal(await hasPinnedCommit(source,revision),true);
  await execute(hasPinnedCommit,command,source,{revision},{});
  assert.equal(fetches,1,'cached exact commit must not fetch again');
 } finally {await rm(root,{recursive:true,force:true});}
});
