import test from 'node:test';import assert from 'node:assert/strict';import {spiderMonkeyRustEnvironment} from './lib/spidermonkey-rust.mjs';
test('old source uses explicitly provisioned toolchain without changing other compilers',()=>{const env={WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.70.0',CXX:'clang++'};assert.equal(spiderMonkeyRustEnvironment(env,'1.66.0').RUSTUP_TOOLCHAIN,'1.70.0');assert.equal(env.RUSTUP_TOOLCHAIN,undefined);assert.equal(spiderMonkeyRustEnvironment(env,'1.66.0').CXX,'clang++');});
test('modern source preserves its Rust selection',()=>{const env={WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.70.0',RUSTUP_TOOLCHAIN:'1.98.1'};assert.deepEqual(spiderMonkeyRustEnvironment(env,'1.95.0'),env);});
test('malformed or below-minimum toolchains fail closed',()=>{assert.throws(()=>spiderMonkeyRustEnvironment({WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.60.0'},'1.66.0'));assert.throws(()=>spiderMonkeyRustEnvironment({WASMFYI_SPIDERMONKEY_LEGACY_RUST:'stable;evil'},'1.66.0'));});
test('legacy build tools are isolated to eligible old source',()=>{const env={WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.70.0',WASMFYI_SPIDERMONKEY_LEGACY_BUILD:'/private/tools',PATH:'/usr/bin'};assert.equal(spiderMonkeyRustEnvironment(env,'1.66.0').M4,'/private/tools/usr/bin/m4');assert.equal(spiderMonkeyRustEnvironment(env,'1.66.0').AC_MACRODIR,'/private/tools/usr/share/autoconf2.13');assert.equal(spiderMonkeyRustEnvironment(env,'1.66.0').PATH,'/private/tools/usr/bin:/usr/bin');assert.deepEqual(spiderMonkeyRustEnvironment(env,'1.95.0'),env);});

test('legacy Python requires explicit eligible Rust and leaves modern/default builders unchanged',()=>{
 const env={WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.70.0',WASMFYI_SPIDERMONKEY_LEGACY_PYTHON:'/private/python/bin/python3.11',WASMFYI_BUILD_PYTHON:'/current/python'};
 assert.equal(spiderMonkeyRustEnvironment(env,'1.66.0').WASMFYI_BUILD_PYTHON,env.WASMFYI_SPIDERMONKEY_LEGACY_PYTHON);
 assert.equal(spiderMonkeyRustEnvironment(env,'1.70.0').WASMFYI_BUILD_PYTHON,env.WASMFYI_SPIDERMONKEY_LEGACY_PYTHON);
 assert.deepEqual(spiderMonkeyRustEnvironment(env,'1.71.0'),env);
 const noRust={...env};delete noRust.WASMFYI_SPIDERMONKEY_LEGACY_RUST;assert.deepEqual(spiderMonkeyRustEnvironment(noRust,'1.66.0'),noRust);
 assert.equal(env.WASMFYI_BUILD_PYTHON,'/current/python');
});
test('eligible legacy Python rejects unsafe/nonabsolute paths without rejecting modern source',()=>{
 for(const python of ['python3.11','/bad path/python','/bad;path/python'.replace(';','\n'),'/bad$path/python','/bad`path/python',"/bad'path/python",'/bad\0path/python']){
  const env={WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.70.0',WASMFYI_SPIDERMONKEY_LEGACY_PYTHON:python};
  assert.throws(()=>spiderMonkeyRustEnvironment(env,'1.66.0'),/Unsafe SpiderMonkey legacy Python/);
  assert.deepEqual(spiderMonkeyRustEnvironment(env,'1.95.0'),env);
 }
});

test('actual source builder selects legacy Python for old source while modern source keeps current Python',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {buildSpiderMonkeySDK}=await import('./lib/spidermonkey-sdk.mjs');
 const dir=await mkdtemp(join(tmpdir(),'spider-rust-builder-'));
 try{for(const minimum of ['1.66.0','1.95.0']){
  const source=join(dir,minimum,'source'),target=join(dir,minimum,'sdk');await mkdir(join(source,'python/mozboot/mozboot'),{recursive:true});await writeFile(join(source,'python/mozboot/mozboot/util.py'),'MINIMUM_RUST_VERSION = "'+minimum+'"');await mkdir(join(target,'obj/dist/bin'),{recursive:true});await writeFile(join(target,'obj/dist/bin/js'),'fixture');const calls=[];
  const env={PATH:'/usr/bin',WASMFYI_BUILD_PYTHON:'/current/python',WASMFYI_SPIDERMONKEY_LEGACY_PYTHON:'/private/python',WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.70.0'};
  const result=await buildSpiderMonkeySDK({source,target,env,run:async(program,args,options)=>{calls.push({program,args,options});return {output:args[0]==='-c'?'3.11.14':''};}});
  const expected=minimum==='1.66.0'?'/private/python':'/current/python';assert.equal(result.python.program,expected);assert.equal(calls[0].program,expected);assert.equal(calls[1].program,expected);assert.equal(calls[1].options.env.WASMFYI_BUILD_PYTHON,expected);
 }}finally{await rm(dir,{recursive:true,force:true});}
});
