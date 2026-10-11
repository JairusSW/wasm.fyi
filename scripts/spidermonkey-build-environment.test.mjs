import test from 'node:test';import assert from 'node:assert/strict';import {spiderMonkeyBuildEnvironment,spiderMonkeyLegacyLinkerEnvironment} from './lib/spidermonkey-sdk.mjs';
test('Mozilla configure receives selected C++ ABI flags as compiler arguments for target and host',()=>{const e=spiderMonkeyBuildEnvironment({WASMFYI_WAVM_CXX_SDK:'/qualified/cxx'});assert.match(e.CXX,/clang\+\+ .*stdlib=libc\+\+/);assert.match(e.CXX,/-nostdinc\+\+/);assert.match(e.CXX,/qualified\/cxx\/include\/c\+\+\/v1/);assert.equal(e.HOST_CXX,e.CXX);assert.equal(e.HOST_CC,e.CC);});
test('normal source builds preserve user compiler selection',()=>{const e=spiderMonkeyBuildEnvironment({CXX:'clang++',CC:'clang'});assert.equal(e.CXX,'clang++');assert.equal(e.CC,'clang');});
test('configure link probes select qualified runtime libraries instead of compiler distribution defaults',()=>{const e=spiderMonkeyBuildEnvironment({WASMFYI_WAVM_CXX_SDK:'/qualified/cxx'});assert.match(e.CXX,/-L\/qualified\/cxx\/lib\/x86_64-unknown-linux-gnu/);assert.match(e.CXX,/-Wl,-rpath,\/qualified\/cxx\/lib\/x86_64-unknown-linux-gnu/);assert.match(e.HOST_CXX,/-fuse-ld=\/qualified\/cxx\/bin\/ld.lld/);});
test('Mozilla visibility wrappers precede qualified C++ system headers',()=>{const e=spiderMonkeyBuildEnvironment({WASMFYI_WAVM_CXX_SDK:'/qualified/cxx'});assert.match(e.CXX,/-isystem \/qualified\/cxx\/include\/c\+\+\/v1/);assert.doesNotMatch(e.CXX,/-I\/qualified\/cxx\/include/);});

test('only explicitly selected Darwin ESR115 uses classic linker; Linux, modern and default selection remain unchanged',()=>{
 const env={CC:'/qualified/clang',CXX:'/qualified/clang++',WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.70.0'};
 for(const [platform,min,e] of [['linux','1.66.0',env],['darwin','1.90.0',env],['darwin','1.66.0',{CC:'clang'}]])assert.deepEqual(spiderMonkeyLegacyLinkerEnvironment(e,min,platform),e);
 const result=spiderMonkeyLegacyLinkerEnvironment(env,'1.66.0','darwin');
 assert.equal(result.INSTALL_NAME_TOOL,'/Library/Developer/CommandLineTools/usr/bin/install_name_tool');
 assert.equal(result.CC,'/qualified/clang -fuse-ld=/Library/Developer/CommandLineTools/usr/bin/ld-classic');
 assert.equal(result.CXX,'/qualified/clang++ -fuse-ld=/Library/Developer/CommandLineTools/usr/bin/ld-classic');
 assert.match(result.HOST_CC,/^\/usr\/bin\/clang -fuse-ld=/);assert.match(result.HOST_CXX,/^\/usr\/bin\/clang\+\+ -fuse-ld=/);
 assert.equal(env.CC,'/qualified/clang');assert.equal(env.HOST_CC,undefined);
});

test('eligible Darwin legacy compiler selection is isolated from modern, Linux, and unselected builders',()=>{
 const env={CC:'user-clang',CXX:'user-clang++',WASMFYI_SPIDERMONKEY_LEGACY_RUST:'1.70.0',WASMFYI_SPIDERMONKEY_LEGACY_CLANG:'/qualified/llvm18/bin'};
 for(const [platform,min,e]of [['linux','1.66.0',env],['darwin','1.90.0',env],['darwin','1.66.0',{...env,WASMFYI_SPIDERMONKEY_LEGACY_RUST:undefined}]])assert.deepEqual(spiderMonkeyLegacyLinkerEnvironment(e,min,platform),e);
 const old=spiderMonkeyLegacyLinkerEnvironment(env,'1.66.0','darwin');assert.match(old.CC,/^\/qualified\/llvm18\/bin\/clang -fuse-ld=/);assert.match(old.CXX,/^\/qualified\/llvm18\/bin\/clang\+\+ -fuse-ld=/);assert.equal(old.HOST_CXX,old.CXX);assert.equal(old.HOST_CC,old.CC);assert.equal(env.CC,'user-clang');
 assert.throws(()=>spiderMonkeyLegacyLinkerEnvironment({...env,WASMFYI_SPIDERMONKEY_LEGACY_CLANG:'relative/bin'},'1.66.0','darwin'),/Unsafe legacy/);
 assert.deepEqual(spiderMonkeyLegacyLinkerEnvironment({...env,WASMFYI_SPIDERMONKEY_LEGACY_CLANG:'relative/bin'},'1.90.0','darwin'),{...env,WASMFYI_SPIDERMONKEY_LEGACY_CLANG:'relative/bin'});
});
