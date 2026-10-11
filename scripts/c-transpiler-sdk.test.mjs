import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {packageWasm2cSIMDe} from './lib/c-transpiler-sdk.mjs';
import {digest} from './lib/wasmbench.mjs';

test('wasm2c installs complete pinned SIMDe include tree and records provenance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasm2c-simde-'));
 try{
  const source=join(root,'source'),sdk=join(root,'sdk'),dependency=join(source,'third_party/simde');
  await mkdir(join(dependency,'simde/wasm'),{recursive:true});
  await writeFile(join(source,'.gitmodules'),'[submodule "simde"]\n path = third_party/simde\n');
  await writeFile(join(dependency,'.git'),'gitdir: fixture');
  await writeFile(join(dependency,'simde/wasm/simd128.h'),'#include "../common.h"\n');
  await writeFile(join(dependency,'simde/common.h'),'nested dependency\n');
  const revision='a'.repeat(40);
  const run=async(_program,args)=>({output:args[0]==='submodule'?' '+revision+' third_party/simde\n':''});
  const receipt=await packageWasm2cSIMDe({source,sdk,run});
  assert.equal(receipt.revision,revision);
  assert.equal(receipt.headerSha256,digest(await readFile(join(dependency,'simde/wasm/simd128.h'))));
  assert.equal(await readFile(join(sdk,'include/simde/common.h'),'utf8'),'nested dependency\n');
  assert.equal(await readFile(join(sdk,'include/simde/wasm/simd128.h'),'utf8'),'#include "../common.h"\n');
  await assert.rejects(packageWasm2cSIMDe({source,sdk,run:async()=>({output:'+'+revision+' third_party/simde\n'})}),/pinned gitlink/);
  await assert.rejects(packageWasm2cSIMDe({source,sdk,run:async(_p,args)=>({output:args[0]==='submodule'?' '+revision+' third_party/simde\n':' M simde/common.h\n'})}),/modified source/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('older wasm2c without a declared SIMDe dependency does not invent one',async()=>{
 const source=await mkdtemp(join(tmpdir(),'wasm2c-old-'));
 try{assert.equal(await packageWasm2cSIMDe({source,sdk:join(source,'sdk'),run:()=>{throw Error('unexpected Git probe')}}),null);}finally{await rm(source,{recursive:true,force:true});}
});
