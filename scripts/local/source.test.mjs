import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {snapshotSource} from './source.mjs';
import {resolveEngine,selectCorpora} from './registry.mjs';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
test('source snapshots preserve dirty files, reuse identity, and never change the author checkout',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-source-'));try{
 const repo=join(root,'repo');await mkdir(repo);git(repo,'init');await writeFile(join(repo,'main.go'),'original');git(repo,'add','.');git(repo,'-c','user.name=test','-c','user.email=test@localhost','commit','-qm','base');
 await writeFile(join(repo,'main.go'),'edit');await writeFile(join(repo,'new.go'),'new');await writeFile(join(repo,'prod.env'),'secret');await symlink('main.go',join(repo,'link'));
 const first=await snapshotSource(repo,root),again=await snapshotSource(repo,root);assert.equal(first.digest,again.digest);assert.equal(first.revision,again.revision);assert.equal(await readFile(join(first.path,'main.go'),'utf8'),'edit');await assert.rejects(readFile(join(first.path,'prod.env')));
 await writeFile(join(repo,'main.go'),'another edit');const changed=await snapshotSource(repo,root);assert.notEqual(first.digest,changed.digest);assert.equal(await readFile(join(repo,'main.go'),'utf8'),'another edit');
 await symlink('/etc/passwd',join(repo,'escape'));await assert.rejects(snapshotSource(repo,root),/escapes/);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('canonical selectors reject unknown engines and match corpus boundaries',()=>{
 assert.equal(resolveEngine('wago-railshot@main').engine,'wago');assert.throws(()=>resolveEngine('no-such-runtime'));
 const rows=[{id:'applications/a'},{id:'applications/ab'},{id:'features/mvp/a'}];assert.deepEqual(selectCorpora(rows,['applications/a']),[rows[0]]);
});
test('worker discovery runs through a symlink from outside the checkout',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi cli-'));try{
  const link=join(root,'worker link.mjs');await symlink(new URL('./worker.mjs',import.meta.url).pathname,link);
  const output=execFileSync(process.execPath,[link,'catalogue'],{cwd:root,encoding:'utf8',maxBuffer:4<<20});const result=JSON.parse(output);
  assert.equal(result.event,'result');assert.ok(result.engines.some(e=>e.id==='wago-railshot'));assert.ok(result.corpora.some(w=>w.id==='mechanisms/wasm-host-wasm-loop'));
 }finally{await rm(root,{recursive:true,force:true})}
});
