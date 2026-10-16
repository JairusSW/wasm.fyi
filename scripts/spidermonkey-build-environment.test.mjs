import test from 'node:test';import assert from 'node:assert/strict';import {spiderMonkeyBuildEnvironment,spiderMonkeyLegacyLinkerEnvironment,resetSpiderMonkeyCompilerCache} from './lib/spidermonkey-sdk.mjs';
test('Linux SpiderMonkey selects the provisioned C++ runtime and its matching loader',()=>{
 const env={WASMFYI_SPIDERMONKEY_CC:'/compiler/clang',WASMFYI_SPIDERMONKEY_CXX:'/compiler/clang++',WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'/qualified/runtime'};
 const result=spiderMonkeyBuildEnvironment(env,'linux');
 assert.match(result.LDFLAGS,/-Wl,--dynamic-linker,\/qualified\/runtime\/ld-linux-x86-64.so.2/);
 assert.match(result.CXX,/-Xlinker -rpath -Xlinker \/qualified\/runtime/);
 assert.match(result.CXX,/-Xlinker --dynamic-linker -Xlinker \/qualified\/runtime\/ld-linux-x86-64.so.2/);
 assert.deepEqual(spiderMonkeyBuildEnvironment(env,'darwin'),env);
 assert.equal(env.LDFLAGS,undefined);
 assert.throws(()=>spiderMonkeyBuildEnvironment({...env,WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'relative'},'linux'),/Unsafe/);
});
test('Darwin SpiderMonkey build keeps native tools without Linux ABI flags',()=>{
 const env={WASMFYI_WAVM_CXX_SDK:'/opt/homebrew/opt/llvm@20',CC:'/native/clang',CXX:'/native/clang++'};
 assert.deepEqual(spiderMonkeyBuildEnvironment(env,'darwin'),env);
});
test('an explicitly provisioned Darwin C++ SDK avoids incompatible newer standard-library headers',()=>{
 const env={CC:'/new/clang',CXX:'/new/clang++',WASMFYI_SPIDERMONKEY_CXX_SDK:'/qualified/llvm18'};
 const result=spiderMonkeyBuildEnvironment(env,'darwin');
 assert.equal(result.CXX,'/qualified/llvm18/bin/clang++');assert.equal(result.HOST_CXX,result.CXX);
 assert.equal(result.CC,'/qualified/llvm18/bin/clang');assert.equal(env.CXX,'/new/clang++');
 assert.deepEqual(spiderMonkeyBuildEnvironment(env,'linux'),env);
 assert.throws(()=>spiderMonkeyBuildEnvironment({...env,WASMFYI_SPIDERMONKEY_CXX_SDK:'relative'},'darwin'),/Unsafe/);
});
test('Mozilla configure receives selected C++ ABI flags as compiler arguments for target and host',()=>{const e=spiderMonkeyBuildEnvironment({WASMFYI_WAVM_CXX_SDK:'/qualified/cxx'},'linux');assert.match(e.CXX,/clang\+\+ .*stdlib=libc\+\+/);assert.match(e.CXX,/-nostdinc\+\+/);assert.match(e.CXX,/qualified\/cxx\/include\/c\+\+\/v1/);assert.equal(e.HOST_CXX,e.CXX);assert.equal(e.HOST_CC,e.CC);});
test('normal source builds preserve user compiler selection',()=>{const e=spiderMonkeyBuildEnvironment({CXX:'clang++',CC:'clang'});assert.equal(e.CXX,'clang++');assert.equal(e.CC,'clang');});
test('configure link probes select qualified runtime libraries instead of compiler distribution defaults',()=>{const e=spiderMonkeyBuildEnvironment({WASMFYI_WAVM_CXX_SDK:'/qualified/cxx'},'linux');assert.match(e.CXX,/-L\/qualified\/cxx\/lib\/x86_64-unknown-linux-gnu/);assert.match(e.CXX,/-Xlinker -rpath -Xlinker \/qualified\/cxx\/lib\/x86_64-unknown-linux-gnu/);assert.match(e.HOST_CXX,/-fuse-ld=\/qualified\/cxx\/bin\/ld.lld/);});
test('Mozilla comma-separated option parser sees exactly one compiler value',()=>{
 const e=spiderMonkeyBuildEnvironment({WASMFYI_WAVM_CXX_SDK:'/qualified/cxx',LDFLAGS:'-Wl,--as-needed'},'linux');
 assert.equal(e.CXX.split(',').length,1);
 assert.equal(e.HOST_CXX,e.CXX);
 assert.match(e.CXX,/-Xlinker --as-needed/);
 assert.match(e.LDFLAGS,/-Wl,-rpath,/);
});
test('Mozilla visibility wrappers precede qualified C++ system headers',()=>{const e=spiderMonkeyBuildEnvironment({WASMFYI_WAVM_CXX_SDK:'/qualified/cxx'},'linux');assert.match(e.CXX,/-isystem \/qualified\/cxx\/include\/c\+\+\/v1/);assert.doesNotMatch(e.CXX,/-I\/qualified\/cxx\/include/);});

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

import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
test('compiler changes discard stale Mozilla objects but retain source and unchanged caches',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mozilla-compiler-')),object=join(root,'obj');
 try{
  await mkdir(object);await writeFile(join(root,'source'),'pinned source');
  await writeFile(join(object,'config.status'),"substs = {'_CXX': '/old/clang++'}");
  await writeFile(join(object,'cached.o'),'object');
  assert.equal(await resetSpiderMonkeyCompilerCache(object,{CXX:'/old/clang++ -isysroot /sdk'}),false);
  assert.equal(await readFile(join(object,'cached.o'),'utf8'),'object');
  assert.equal(await resetSpiderMonkeyCompilerCache(object,{CXX:'/new/clang++'}),true);
  assert.equal(await stat(object).catch(()=>null),null);
  assert.equal(await readFile(join(root,'source'),'utf8'),'pinned source');
  assert.equal(await resetSpiderMonkeyCompilerCache(object,{CXX:'/new/clang++'}),false);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('ESR115 Darwin zlib sees stdio before its classic Mac fdopen macro independently of Rust selection',async()=>{
 const {spiderMonkeyZlibEnvironment}=await import('./lib/spidermonkey-sdk.mjs');
 const env={CC:'clang',CFLAGS:'-O2'};
 assert.equal(spiderMonkeyZlibEnvironment(env,'1.66.0','darwin').CFLAGS,'-O2 -include stdio.h');
 assert.equal(spiderMonkeyZlibEnvironment({CFLAGS:'-include stdio.h'},'1.66.0','darwin').CFLAGS,'-include stdio.h');
 assert.deepEqual(spiderMonkeyZlibEnvironment(env,'1.66.0','linux'),env);
 assert.deepEqual(spiderMonkeyZlibEnvironment(env,'1.90.0','darwin'),env);
 assert.equal(env.CFLAGS,'-O2');
});
test('Mozilla objects are refreshed once when the required C stdio preinclude is absent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mozilla-stdio-')),object=join(root,'obj');
 try{
  await mkdir(object);await writeFile(join(object,'config.status'),"substs = {'_CXX': '/same/clang++', 'OS_CFLAGS': ['-O2']}");
  const env={CXX:'/same/clang++',CFLAGS:'-O2 -include stdio.h'};
  assert.equal(await resetSpiderMonkeyCompilerCache(object,env),true);
  await mkdir(object);await writeFile(join(object,'config.status'),"substs = {'_CXX': '/same/clang++', 'OS_CFLAGS': ['-O2', '-include', 'stdio.h']}");
  assert.equal(await resetSpiderMonkeyCompilerCache(object,env),false);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('Mozilla Rust option retains private linker arguments without comma-separated values',()=>{
 const env={RUSTFLAGS:'-C target-cpu=x86-64 -C link-arg=-Wl,--dynamic-linker,/qualified/ld.so -Clink-arg=-Wl,-rpath,/qualified/lib -C link-arg=-Wl,--disable-new-dtags'};
 const value=spiderMonkeyBuildEnvironment(env,'linux').RUSTFLAGS;
 assert.equal(value.split(',').length,1);
 assert.equal(value,'-C target-cpu=x86-64 -C link-arg=-Xlinker -C link-arg=--dynamic-linker -C link-arg=-Xlinker -C link-arg=/qualified/ld.so -Clink-arg=-Xlinker -Clink-arg=-rpath -Clink-arg=-Xlinker -Clink-arg=/qualified/lib -C link-arg=-Xlinker -C link-arg=--disable-new-dtags');
 assert.match(env.RUSTFLAGS,/-Wl,/);
});

test('explicit Linux SpiderMonkey compilers bypass the shared libc++ SDK without mutating its environment',()=>{
 const env={WASMFYI_WAVM_CXX_SDK:'/shared/llvm20',WASMFYI_NODE_CXX_SDK:'/shared/node',WASMFYI_SPIDERMONKEY_CC:'/qualified/bin/clang',WASMFYI_SPIDERMONKEY_CXX:'/qualified/bin/clang++',CXXFLAGS:'-stdlib=libstdc++',LDFLAGS:'-Wl,--as-needed'};
 const result=spiderMonkeyBuildEnvironment(env,'linux');
 assert.equal(result.CC,'/qualified/bin/clang');
 assert.equal(result.CXX,'/qualified/bin/clang++ -stdlib=libstdc++ -Xlinker --as-needed');
 assert.equal(result.HOST_CXX,result.CXX);assert.equal(result.HOST_CC,result.CC);
 assert.doesNotMatch(result.CXX,/nostdinc|libc\+\+/);assert.equal(env.WASMFYI_WAVM_CXX_SDK,'/shared/llvm20');
 assert.deepEqual(spiderMonkeyBuildEnvironment(env,'darwin'),env);
 assert.throws(()=>spiderMonkeyBuildEnvironment({...env,WASMFYI_SPIDERMONKEY_CXX:'relative'},'linux'),/Unsafe/);
 assert.throws(()=>spiderMonkeyBuildEnvironment({...env,WASMFYI_SPIDERMONKEY_CC:undefined},'linux'),/Unsafe/);
});
