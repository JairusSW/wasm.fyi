import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sdkBuildOverrides} from './lib/sdk-build-overrides.mjs';

test('SDK tool overrides are absent by default and apply only to the selected engine',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-sdk-overrides-'));
 try {
  const sdk=join(root,'sdk-builds','spider');await mkdir(sdk,{recursive:true});
  assert.equal(await sdkBuildOverrides(sdk,'spidermonkey'),null);
  const values={WASMFYI_BUILD_PYTHON:'/tools/python3.12',WASMFYI_SPIDERMONKEY_CXX_SDK:'/tools/llvm20',WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.70.0'};
  await writeFile(join(root,'sdk-build-overrides.json'),JSON.stringify({schema:1,engines:{spidermonkey:values}}));
  const result=await sdkBuildOverrides(sdk,'spidermonkey');assert.deepEqual(result.env,values);assert.match(result.provenance.sha256,/^[a-f0-9]{64}$/);
  assert.equal(await sdkBuildOverrides(sdk,'w2c2'),null);
  assert.equal(await sdkBuildOverrides(join(root,'unrelated','spider'),'spidermonkey'),null);
  await writeFile(join(root,'sdk-build-overrides.json'),JSON.stringify({schema:1,engines:{spidermonkey:{WASMFYI_BUILD_PYTHON:'/tools/python3.11'}}}));
  assert.equal((await sdkBuildOverrides(sdk,'spidermonkey')).env.WASMFYI_BUILD_PYTHON,'/tools/python3.11');
 }finally {await rm(root,{recursive:true,force:true});}
});

test('SDK override file cannot change workload settings or inject shell/loader options',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-sdk-overrides-'));
 try {
  const sdk=join(root,'sdk-builds','spider');await mkdir(sdk,{recursive:true});
  for(const selected of [{LD_PRELOAD:'/tmp/untrusted.so'},{WASMFYI_BUILD_PYTHON:'relative'},{WASMFYI_BUILD_PYTHON:'/bin/python\nextra'},{WASMFYI_SPIDERMONKEY_LEGACY_RUST:'stable'},{samples:1}]) {
   await writeFile(join(root,'sdk-build-overrides.json'),JSON.stringify({schema:1,engines:{spidermonkey:selected}}));
   await assert.rejects(sdkBuildOverrides(sdk,'spidermonkey'));
  }
 }finally {await rm(root,{recursive:true,force:true});}
});
