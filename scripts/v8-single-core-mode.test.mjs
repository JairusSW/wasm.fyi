import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {applyV8SingleCoreMode} from './lib/v8-single-core-mode.mjs';
const execute=promisify(execFile);

test('installer recognizes the prior verified single-threaded parser layout without rejecting an already patched harness',async()=>{
 const original=process.env.WASMFYI_TEST_HARNESS;
 assert.ok(original,'actual source-bound harness is required');
 const root=await mkdtemp(join(tmpdir(),'v8-prior-compiler-contract-'));
 try {
  await mkdir(join(root,'adapters/v8'),{recursive:true});
  const file=join(root,'adapters/v8/compiler-mode.mjs');
  let source=await readFile(join(original,'adapters/v8/compiler-mode.mjs'),'utf8');
  const guard="if(JSON.stringify(flags)!==JSON.stringify(expected) && JSON.stringify(flags)!==JSON.stringify([...expected,'--no-wasm-native-module-cache']))";
  if(source.includes('const singleCoreCompilerFlags='))source=source.replace(/const singleCoreCompilerFlags=[^\n]*;\n  const verifiedSequences=[^\n]*;\n  if\(!verifiedSequences\.some\(sequence=>JSON\.stringify\(flags\)===JSON\.stringify\(sequence\)\)\)/,guard);
  if(!source.includes('const controlled=singleThreaded.every'))source=source.replace(guard,"const singleThreaded=['--single-threaded','--single-threaded-gc','--wasm-num-compilation-tasks=0'];\n  const controlled=singleThreaded.every((flag,index)=>flags[index]===flag)?flags.slice(singleThreaded.length):flags;\n  "+guard.replaceAll('JSON.stringify(flags)','JSON.stringify(controlled)'));
  assert.ok(source.includes('const controlled=singleThreaded.every'));
  await writeFile(file,source);
  assert.equal(await applyV8SingleCoreMode(root),false);
  assert.equal(await readFile(file,'utf8'),source);
  const {parseCompilerMode,compilerModeFlags}=await import(pathToFileURL(file));
  const prefix=['--single-threaded','--single-threaded-gc','--wasm-num-compilation-tasks=0'];
  for(const [mode,flags]of Object.entries(compilerModeFlags)){
   assert.equal(parseCompilerMode(['--compiler-mode='+mode],[...prefix,...flags],{}),mode);
   assert.throws(()=>parseCompilerMode(['--compiler-mode='+mode],[...prefix.slice(1),...flags],{}));
  }
 } finally {await rm(root,{recursive:true,force:true});}
});

test('actual V8 parser accepts the full single-core policy while rejecting incomplete/contradictory flag sequences',async()=>{
 const original=process.env.WASMFYI_TEST_HARNESS;
 assert.ok(original,'actual source-bound harness is required');
 const root=await mkdtemp(join(tmpdir(),'v8-compiler-contract-'));
 try {
  await mkdir(join(root,'adapters/v8'),{recursive:true});
  const file=join(root,'adapters/v8/compiler-mode.mjs');
  await copyFile(join(original,'adapters/v8/compiler-mode.mjs'),file);
  // The qualified harness may already contain the fix. Restore only this
  // exact prior guard in our disposable fixture to exercise installation.
  const source=await readFile(file,'utf8');
  if(source.includes('const singleCoreCompilerFlags=')){
   const restored=source.replace(/const singleCoreCompilerFlags=[^\n]*;\n  const verifiedSequences=[^\n]*;\n  if\(!verifiedSequences\.some\(sequence=>JSON\.stringify\(flags\)===JSON\.stringify\(sequence\)\)\)/,"if(JSON.stringify(flags)!==JSON.stringify(expected) && JSON.stringify(flags)!==JSON.stringify([...expected,'--no-wasm-native-module-cache']))");
   assert.ok(!restored.includes('const singleCoreCompilerFlags='),'source-bound fixture seam changed');
   await writeFile(file,restored);
  }
  for(const directory of ['experiment','cmd/wasmbench','adapters/js-shell'])await mkdir(join(root,directory),{recursive:true});
  await writeFile(join(root,'experiment/types.go'),'type Options struct { AdaptiveSamples bool; SteadyOperations int; adaptiveSessions bool }');
  await writeFile(join(root,'experiment/runner.go'),'package experiment\nfunc sample(){\n\t\tswitch id {\n default: break\n }\n\t\tfor _, path := range r.Command {\n }\n}\n');
  await writeFile(join(root,'cmd/wasmbench/main.go'),'package main');
  await writeFile(join(root,'adapters/js-shell/adapter.js'),'let cachedModule, cachedSteady, cachedVectors;');
  // Drive the production installer, so an imported-but-unused patch fails.
  await execute(process.execPath,[new URL('./apply-controller-sampling.mjs',import.meta.url).pathname,root]);
  const first=await readFile(file,'utf8');
  assert.equal(await applyV8SingleCoreMode(root),false);
  assert.equal(await readFile(file,'utf8'),first);
  const {parseCompilerMode,compilerModeFlags}=await import(pathToFileURL(file));
  const prefix=['--single-threaded','--single-threaded-gc','--wasm-num-compilation-tasks=0'];
  for(const [mode,flags] of Object.entries(compilerModeFlags)){
   const argv=['--compiler-mode='+mode];
   for(const cache of [[],['--no-wasm-native-module-cache']]){
    const actual=[...prefix,...flags,...cache];
    assert.equal(parseCompilerMode(argv,actual,{}),mode);
    for(const invalid of [[...prefix.slice(1),...flags,...cache],[...prefix,...flags,...cache,'--wasm-tier-up'],[...prefix,...flags,...cache,'--wasm-num-compilation-tasks=2'],[...flags,...prefix,...cache],[...prefix,...flags].reverse()])assert.throws(()=>parseCompilerMode(argv,invalid,{}));
    assert.throws(()=>parseCompilerMode(argv,actual,{NODE_OPTIONS:'--wasm-tier-up'}));
   }
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
