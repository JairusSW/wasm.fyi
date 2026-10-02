import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifySeal} from './lib/verify-seal.mjs';
import {digest} from './lib/wasmbench.mjs';
test('Finder metadata exception preserves evidence and strict archive coverage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'seal-finder-'));
 try {
  const evidence='evidence';const hash=digest(evidence);
  await writeFile(join(root,'data.json'),evidence);
  await writeFile(join(root,'.DS_Store'),'new Finder metadata');
  await writeFile(join(root,'checksums.json'),JSON.stringify({'data.json':hash,'.DS_Store':digest('old Finder metadata')}));
  await verifySeal(root);
  await writeFile(join(root,'data.json'),'altered');await assert.rejects(verifySeal(root),/checksum mismatch/);
  await writeFile(join(root,'data.json'),evidence);
  await writeFile(join(root,'extra'),'unknown');await assert.rejects(verifySeal(root),/exact archive/);await rm(join(root,'extra'));
  await mkdir(join(root,'nested'));await writeFile(join(root,'nested/.DS_Store'),'Finder metadata');await assert.doesNotReject(verifySeal(root));await writeFile(join(root,'nested/extra'),'unknown');await assert.rejects(verifySeal(root),/exact archive/);await rm(join(root,'nested'),{recursive:true});
  await rm(join(root,'.DS_Store'));await symlink('data.json',join(root,'.DS_Store'));await assert.rejects(verifySeal(root),/symlinks/);
 } finally {await rm(root,{recursive:true,force:true});}
});
