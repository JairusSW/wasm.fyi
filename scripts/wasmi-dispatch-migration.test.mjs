import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {peelLegacyWasmiFeatures} from './lib/harness-patch.mjs';
const patch='diff --git a/dispatch.txt b/dispatch.txt\n--- a/dispatch.txt\n+++ b/dispatch.txt\n@@ -1 +1 @@\n-"portable-dispatch"\n+"auto-dispatch", "memory64", "simd"\n';
test('peels only the exact old portable shipped-feature state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmi-patch-migration-'));
 try {
  const file=join(root,'dispatch.txt');
  await writeFile(file,'"portable-dispatch", "memory64", "simd"\n');
  assert(peelLegacyWasmiFeatures(root,patch));
  assert.equal(await readFile(file,'utf8'),'"portable-dispatch"\n');
  await writeFile(file,'"auto-dispatch", "memory64", "simd"\n');
  assert.equal(peelLegacyWasmiFeatures(root,patch),null);
  await writeFile(file,'custom binding\n');
  assert.equal(peelLegacyWasmiFeatures(root,patch),null);
  assert.equal(await readFile(file,'utf8'),'custom binding\n');
 } finally {await rm(root,{recursive:true,force:true})}
});
