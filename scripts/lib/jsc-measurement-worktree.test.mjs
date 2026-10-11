import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareJavaScriptCoreMeasurementWorktree,prepareJavaScriptCoreSourceCheckout} from './jsc-measurement-worktree.mjs';
const execute=promisify(execFile);
const run=async(program,args)=>({output:(await execute(program,args)).stdout});

test('sparse measurement worktree retains SDK sources and root build files without changing upstream checkout',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wasmfyi-jsc-worktree-'));
 try{
  const source=join(directory,'source'),target=join(directory,'measurement');await mkdir(source);
  await run('git',['init','--quiet',source]);
  const files={'CMakeLists.txt':'root build','Source/JavaScriptCore/wasm/WasmModule.cpp':'engine source','Tools/Scripts/build-jsc':'build tool','WebKitLibraries/README':'bundled libraries','LayoutTests/example.html':'unrelated test','JSTests/test.js':'unrelated test','Websites/example/index.html':'unrelated website'};
  for(const [name,body] of Object.entries(files)){await mkdir(dirname(join(source,name)),{recursive:true});await writeFile(join(source,name),body);}
  await run('git',['-C',source,'add','.']);await run('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Pinned source']);
  const revision=(await run('git',['-C',source,'rev-parse','HEAD'])).output.trim();
  const receipt=await prepareJavaScriptCoreMeasurementWorktree({source,target,revision,run,sparse:true});
  assert.equal(receipt.checkoutPolicy,'sparse-source-tools-libraries');
  for(const name of ['CMakeLists.txt','Source/JavaScriptCore/wasm/WasmModule.cpp','Tools/Scripts/build-jsc','WebKitLibraries/README'])assert.equal(await readFile(join(target,name),'utf8'),files[name]);
  for(const name of ['LayoutTests/example.html','JSTests/test.js','Websites/example/index.html']){assert.equal(await stat(join(target,name)).catch(()=>null),null);assert.equal(await readFile(join(source,name),'utf8'),files[name]);}
  assert.equal((await run('git',['-C',source,'status','--porcelain'])).output,'');
  assert.equal((await run('git',['-C',target,'status','--porcelain'])).output,'');
  const base=await prepareJavaScriptCoreSourceCheckout({source,revision,run,ensureCapacity:async()=>{}});
  assert.equal(base.checkoutPolicy,'existing-source-preserved');
  assert.equal(await readFile(join(source,'LayoutTests/example.html'),'utf8'),files['LayoutTests/example.html']);
  // A qualified SDK's private patch must survive later attempts to reuse it.
  const patched=join(target,'Source/JavaScriptCore/wasm/WasmModule.cpp');await writeFile(patched,'qualified measurement patch');
  const reused=await prepareJavaScriptCoreMeasurementWorktree({source,target,revision,run,sparse:false});
  assert.equal(reused.created,false);assert.equal(reused.checkoutPolicy,'existing-worktree-preserved');assert.equal(await readFile(patched,'utf8'),'qualified measurement patch');
  await assert.rejects(prepareJavaScriptCoreMeasurementWorktree({source,target,revision:'0'.repeat(40),run,sparse:true}),/different source revision/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('invalid pins and upstream alias fail before any Git mutation',async()=>{
 let called=false;const unused=async()=>{called=true;throw Error('Unexpected command');};
 await assert.rejects(prepareJavaScriptCoreMeasurementWorktree({source:'/source',target:'/measurement',revision:'main',run:unused}),/Invalid/);
 await assert.rejects(prepareJavaScriptCoreMeasurementWorktree({source:'/source',target:'/source',revision:'a'.repeat(40),run:unused}),/separate/);
 assert.equal(called,false);
});

test('source capacity failure precedes all Git mutations and fetches',async()=>{
 let commands=0;
 await assert.rejects(prepareJavaScriptCoreSourceCheckout({source:'/never-created',revision:'a'.repeat(40),run:async()=>{commands++;},ensureCapacity:async()=>{throw Error('Insufficient disk capacity');}}),/Insufficient disk/);
 assert.equal(commands,0);
});

test('new source uses a filtered fetch and sparse policy before its first checkout',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wasmfyi-jsc-source-plan-'));
 try{
  const commands=[],revision='a'.repeat(40);
  const result=await prepareJavaScriptCoreSourceCheckout({source:join(directory,'source'),revision,ensureCapacity:async()=>{commands.push(['capacity']);},run:async(program,args)=>{
   commands.push([program,...args]);
   return {output:args.includes('get-url')?'https://github.com/WebKit/WebKit.git\n':args.includes('rev-parse')?revision+'\n':''};
  }});
  assert.equal(commands[0][0],'capacity');
  const fetch=commands.findIndex(c=>c.includes('fetch')),sparse=commands.findIndex(c=>c.includes('sparse-checkout')),checkout=commands.findIndex(c=>c.includes('checkout'));
  assert.ok(fetch<sparse&&sparse<checkout);assert.ok(commands[fetch].includes('--filter=blob:none'));
  assert.equal(result.checkoutPolicy,'partial-clone-sparse-source-tools-libraries');
 }finally{await rm(directory,{recursive:true,force:true});}
});
