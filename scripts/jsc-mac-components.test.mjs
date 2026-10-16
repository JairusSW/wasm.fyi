import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {javaScriptCoreMacComponentPolicy,prepareJavaScriptCoreMacComponents} from './lib/jsc-mac-components.mjs';
const upstream='set(ENABLE_WEBKIT_LEGACY ON)\nset(ENABLE_WEBKIT ON)\nSET_AND_EXPOSE_TO_BUILD(USE_LIBWEBRTC TRUE)\nset(USE_ANGLE_EGL ON)\nset(JavaScriptCore_LIBRARY_TYPE SHARED)\n';
test('actual CMake option evaluation retains disabled browser components only after compatibility policy',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jsc-mac-cmake-'));
 try{
  const script=join(dir,'probe.cmake');
  await writeFile(script,'macro(SET_AND_EXPOSE_TO_BUILD name value)\n set(${name} ${value})\nendmacro()\ninclude("${OPTIONS_MAC}")\nforeach(component ENABLE_WEBKIT ENABLE_WEBKIT_LEGACY USE_LIBWEBRTC USE_ANGLE_EGL)\n if(${component})\n  message(FATAL_ERROR "Browser component forced on: ${component}")\n endif()\nendforeach()\nif(NOT JavaScriptCore_LIBRARY_TYPE STREQUAL "SHARED")\n message(FATAL_ERROR "Framework policy changed")\nendif()\n');
  const path=join(dir,'OptionsMac.cmake');
  const run=()=>spawnSync('cmake',['-DOPTIONS_MAC='+path,'-DENABLE_WEBKIT=OFF','-DENABLE_WEBKIT_LEGACY=OFF','-DUSE_LIBWEBRTC=OFF','-DUSE_ANGLE_EGL=OFF','-P',script],{encoding:'utf8'});
  await writeFile(path,upstream);const before=run();assert.equal(before.status,1);assert.match(before.stderr,/Browser component forced on/);
  await writeFile(path,javaScriptCoreMacComponentPolicy(upstream));const after=run();assert.equal(after.status,0,after.stderr);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('opt-in worktree patch preserves upstream source, records hashes and refuses unrelated changes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jsc-mac-worktree-'));const source=join(dir,'source'),target=join(dir,'target'),file='Source/cmake/OptionsMac.cmake';
 try{
  assert.equal(await prepareJavaScriptCoreMacComponents({source,target,enabled:false}),null);
  for(const root of [source,target]){await mkdir(join(root,'Source/cmake'),{recursive:true});await writeFile(join(root,file),upstream);}
  const proof=await prepareJavaScriptCoreMacComponents({source,target,enabled:true});assert.match(proof.upstreamSha256,/^[a-f0-9]{64}$/);assert.notEqual(proof.upstreamSha256,proof.patchedSha256);assert.equal(await readFile(join(source,file),'utf8'),upstream);
  assert.deepEqual(await prepareJavaScriptCoreMacComponents({source,target,enabled:true}),proof);
  await writeFile(join(target,file),'unrelated change');await assert.rejects(prepareJavaScriptCoreMacComponents({source,target,enabled:true}),/Preserve unrelated/);
  assert.equal(await readFile(join(target,file),'utf8'),'unrelated change');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unknown partial or duplicate upstream configuration fails closed',()=>{
 assert.equal(javaScriptCoreMacComponentPolicy('set(ENABLE_WEBKIT OFF)\n'),null);
 assert.throws(()=>javaScriptCoreMacComponentPolicy('set(ENABLE_WEBKIT ON)\n'),/Unrecognized/);
 assert.throws(()=>javaScriptCoreMacComponentPolicy(upstream+'set(ENABLE_WEBKIT ON)\n'),/Unrecognized/);
});
