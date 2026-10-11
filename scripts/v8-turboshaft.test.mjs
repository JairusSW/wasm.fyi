import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {selectV8TurboshaftPolicy,applyV8Turboshaft} from './lib/v8-turboshaft.mjs';
test('explicit legacy flag or source-proven mandatory pipeline, never guessed from version',()=>{
 assert.equal(selectV8TurboshaftPolicy('  --turboshaft-wasm (enable wasm)'),'explicit-flag');
 assert.equal(selectV8TurboshaftPolicy('--turboshaft-wasm-load-elimination','result=ExecuteTurboshaftWasmCompilation('),'mandatory-source-default');
 assert.throws(()=>selectV8TurboshaftPolicy('', 'ExecuteTurboshaftWasmCompilation( ExecuteTurbofanWasmCompilation('));assert.throws(()=>selectV8TurboshaftPolicy(''));
});
test('patch preserves exact ordered parser and adds distinct backend plus native flags idempotently',async()=>{
 const r=await mkdtemp(join(tmpdir(),'v8-ts-'));try{await mkdir(join(r,'experiment'));await mkdir(join(r,'adapters/v8'),{recursive:true});
 await writeFile(join(r,'experiment/runner.go'),'r.Command = append(r.Command, "--allow-natives-syntax", "--no-liftoff", "--no-wasm-tier-up", "--no-wasm-lazy-compilation")');
 await writeFile(join(r,'adapters/v8/compiler-mode.mjs'),`export function parse(argv,flags){const mode=argv[0].slice('--compiler-mode='.length);if(JSON.stringify(flags)!==JSON.stringify(['--allow-natives-syntax','--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation','--no-wasm-native-module-cache-enabled']))throw Error('flags');return mode;}`);
 await writeFile(join(r,'adapters/v8/adapter.mjs'),"configuration.compiler_mode=configuration.tiering=compilerMode;backend: compilerMode==='production-default'?'production-default-tiering':compilerMode");
 await writeFile(join(r,'adapters/v8/native-size.mjs'),"['--no-wasm-lazy-compilation',selected]");await applyV8Turboshaft(r);
 const p=await import('file://'+join(r,'adapters/v8/compiler-mode.mjs'));const f=['--allow-natives-syntax','--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation','--turboshaft-wasm','--no-wasm-native-module-cache-enabled'];assert.equal(p.parse(['--compiler-mode=optimizing-only'],f),'optimizing-only');assert.throws(()=>p.parse(['--compiler-mode=optimizing-only'],[...f,'--turboshaft-wasm']));assert.throws(()=>p.parse(['--compiler-mode=liftoff-only'],f));assert.throws(()=>p.parse(['--compiler-mode=optimizing-only'],[f[4],...f.slice(0,4),f[5]]));
 const before=await readFile(join(r,'adapters/v8/adapter.mjs'),'utf8');assert.match(before,/wasm_compiler_policy/);await applyV8Turboshaft(r);assert.equal(await readFile(join(r,'adapters/v8/adapter.mjs'),'utf8'),before);
 }finally{await rm(r,{recursive:true,force:true});}
});
test('actual pinned parser retains legacy cache and single-core strictness',{skip:!process.env.WASMFYI_TEST_HARNESS},async()=>{
 const r=await mkdtemp(join(tmpdir(),'v8-ts-real-'));try{await mkdir(join(r,'experiment'));await mkdir(join(r,'adapters/v8'),{recursive:true});await writeFile(join(r,'experiment/runner.go'),'r.Command = append(r.Command, "--allow-natives-syntax", "--no-liftoff", "--no-wasm-tier-up", "--no-wasm-lazy-compilation")');await writeFile(join(r,'adapters/v8/adapter.mjs'),"configuration.compiler_mode=configuration.tiering=compilerMode;backend: compilerMode==='production-default'?'production-default-tiering':compilerMode");await writeFile(join(r,'adapters/v8/compiler-mode.mjs'),await readFile(join(process.env.WASMFYI_TEST_HARNESS,'adapters/v8/compiler-mode.mjs')));
 const {applyV8SingleCoreMode}=await import('./lib/v8-single-core-mode.mjs');const {applyV8CacheFlag}=await import('./lib/v8-cache-flag.mjs');await applyV8SingleCoreMode(r);await applyV8CacheFlag(r);await applyV8Turboshaft(r);const {parseCompilerMode}=await import('file://'+join(r,'adapters/v8/compiler-mode.mjs'));
 const flags=['--single-threaded','--single-threaded-gc','--wasm-num-compilation-tasks=0','--allow-natives-syntax','--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation','--turboshaft-wasm','--no-wasm-native-module-cache-enabled'];assert.equal(parseCompilerMode(['--compiler-mode=optimizing-only'],flags,{}),'optimizing-only');assert.throws(()=>parseCompilerMode(['--compiler-mode=optimizing-only'],flags.slice(1),{}));assert.throws(()=>parseCompilerMode(['--compiler-mode=optimizing-only'],[...flags,'--no-turboshaft-wasm'],{}));assert.throws(()=>parseCompilerMode(['--compiler-mode=optimizing-only'],flags,{NODE_OPTIONS:'--future'}));
 }finally{await rm(r,{recursive:true,force:true});}
});
