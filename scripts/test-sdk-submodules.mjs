import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifySDKSubmodules} from './lib/sdk-submodules.mjs';

test('initialized nested pins verified without entering optional uninitialized tests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sdk-submodules-')),sha='a'.repeat(40),calls=[];
 try {
  await mkdir(join(root,'lib/napi/quickjs'),{recursive:true});
  await writeFile(join(root,'lib/napi/.git'),'gitdir: metadata');await writeFile(join(root,'lib/napi/quickjs/.git'),'gitdir: metadata');
  await writeFile(join(root,'lib/napi/.gitmodules'),'[submodule "quickjs"]\n path = quickjs\n');
  await writeFile(join(root,'lib/napi/quickjs/.gitmodules'),'[submodule "test262"]\n path = test262\n update = none\n');
  const run=async(program,args,{cwd})=>{
   assert.equal(program,'git');assert.ok(!args.includes('--recursive'));calls.push(cwd);
   return {output:cwd===root?' '+sha+' lib/napi\n':cwd.endsWith('/quickjs')?' '+sha+' test262\n':' '+sha+' quickjs\n'};
  };
  assert.deepEqual(await verifySDKSubmodules(root,['lib/napi'],run),[
   {path:'lib/napi',revision:sha,initialized:true},
   {path:'lib/napi/quickjs',revision:sha,initialized:true},
   {path:'lib/napi/quickjs/test262',revision:sha,initialized:false},
  ]);
  assert.equal(calls.length,3);
  await assert.rejects(verifySDKSubmodules(root,['lib/napi'],async()=>({output:'+'+sha+' lib/napi\n'})),/pinned gitlink/);
  await assert.rejects(verifySDKSubmodules(root,['lib/napi'],async()=>({output:'-'+sha+' lib/napi\n'})),/Required SDK submodule/);
 } finally {await rm(root,{recursive:true,force:true});}
});
