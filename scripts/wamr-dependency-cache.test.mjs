import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildWamrSDK} from './lib/wamr-sdk.mjs';
const exec=promisify(execFile);
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
test('independent WAMR SDK builds reuse pinned FetchContent without keeping a stale dependency revision',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wamr-dependency-cache-'));
 try{
  const dependency=join(root,'dependency'),source=join(root,'wamr'),platform=join(source,'product-mini/platforms',process.platform),bin=join(root,'bin'),log=join(root,'git-calls');
  await mkdir(dependency);await mkdir(platform,{recursive:true});await mkdir(join(source,'core/iwasm/include'),{recursive:true});await mkdir(bin);
  const git=(await exec('which',['git'])).stdout.trim();
  const call=(args)=>exec(git,args,{cwd:dependency});
  await call(['init']);await call(['config','user.name','SDK test']);await call(['config','user.email','sdk-test@example.invalid']);await call(['config','commit.gpgsign','false']);await call(['config','tag.gpgsign','false']);await call(['config','core.hooksPath','/dev/null']);
  for(const version of [2,3]){
   await writeFile(join(dependency,'pin.txt'),String(version));await writeFile(join(dependency,'fixture.h'),`#define FIXTURE_PIN ${version}\n`);
   await call(['add','.']);await call(['commit','-m',`Dependency ${version}`]);await call(['tag',`v0.8.${version}`]);
  }
  await writeFile(join(source,'core/iwasm/include/wasm.h'),'/* fixture */\n');
  await writeFile(join(platform,'fixture.c'),'#include "fixture.h"\nint cache_fixture(void) { return FIXTURE_PIN; }\n');
  const cmake=tag=>`cmake_minimum_required(VERSION 3.16)\nproject(wamr_cache_fixture C CXX)\ninclude(FetchContent)\nFetchContent_Declare(simde GIT_REPOSITORY "${dependency}" GIT_TAG ${tag})\nFetchContent_MakeAvailable(simde)\nfile(READ "\${simde_SOURCE_DIR}/pin.txt" pin)\nfile(WRITE "\${CMAKE_BINARY_DIR}/cached-pin.txt" "\${pin}")\nadd_library(vmlib SHARED fixture.c)\nset_target_properties(vmlib PROPERTIES OUTPUT_NAME iwasm)\ntarget_include_directories(vmlib PRIVATE "\${simde_SOURCE_DIR}")\n`;
  await writeFile(join(platform,'CMakeLists.txt'),cmake('v0.8.2'));
  await writeFile(join(bin,'git'),`#!/bin/sh\nprintf '%s\\n' "$1" >> ${quote(log)}\nexec ${quote(git)} "$@"\n`);await chmod(join(bin,'git'),0o755);
  const env={...process.env,PATH:bin+':'+process.env.PATH,WASMFYI_WAMR_CMAKE_CACHE:join(root,'shared-dependencies'),WASMFYI_BUILD_JOBS:'2'};
  const run=async(program,args)=>{const r=await exec(program,args,{env,maxBuffer:4*1024*1024});return {output:r.stdout+r.stderr}};
  const build=async name=>{const target=join(root,name);await buildWamrSDK({source,sdk:join(root,name+'-sdk'),target,configuration:'wamr',version:'fixture',env,run});return readFile(join(target,'cached-pin.txt'),'utf8')};
  assert.equal(await build('first'),'2');assert.equal(await build('second'),'2');
  const clones=(await readFile(log,'utf8')).split('\n').filter(s=>s==='clone').length;
  assert.equal(clones,1,'A second SDK at the same dependency pin must not clone it again');
  assert.equal((await readFile(log,'utf8')).split('\n').filter(s=>s==='fetch').length,0,'An unchanged dependency pin must not require a network update');
  await writeFile(join(platform,'CMakeLists.txt'),cmake('v0.8.3'));
  assert.equal(await build('changed-pin'),'3','A new dependency pin must never reuse stale headers');
 }finally{await rm(root,{recursive:true,force:true})}
});
