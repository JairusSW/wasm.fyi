import test from 'node:test';import assert from 'node:assert/strict';import {compilerCacheEnvironment,configureNodeCompilerCache,summarizeCompilerCacheStats} from './lib/node-compiler-cache.mjs';
import {mkdtemp,writeFile,symlink,rm,realpath} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('strict cache resets unsafe inherited settings and preserves compiler flags',()=>{const env=compilerCacheEnvironment({CC:'/usr/bin/gcc',CXX:'/usr/bin/g++',CXXFLAGS:'-O3',CCACHE_SLOPPINESS:'system_headers,time_macros',CCACHE_IGNOREHEADERS:'/usr/include'},{program:'/cache/bin/ccache',directory:'/cache/objects',config:'/cache/config',source:'/src/version',statsLog:'/src/log',extraFiles:['/usr/bin/as']});assert.equal(env.CC,'/cache/bin/ccache /usr/bin/gcc');assert.equal(env.CXXFLAGS,'-O3');assert.equal(env.CCACHE_COMPILERCHECK,'content');assert.equal(env.CCACHE_SLOPPINESS,'');assert.equal(env.CCACHE_NOINODECACHE,'1');assert.equal(env.CCACHE_HASHDIR,'1');assert.equal(env.CCACHE_MAXSIZE,'8GiB');assert.equal(env.CCACHE_IGNOREHEADERS,undefined);assert.throws(()=>compilerCacheEnvironment({CC:'ccache gcc',CXX:'/usr/bin/g++'},{program:'/cache/bin/ccache',directory:'/cache/objects',config:'/cache/config',source:'/src/version',statsLog:'/src/log'}));});
test('per-build log separates actual ICU/V8 hits and misses',()=>{assert.deepEqual(summarizeCompilerCacheStats('# ../deps/icu-small/source/common/a.cpp\ndirect_cache_hit\n# ../deps/v8/src/wasm/a.cc\ndirect_cache_miss\npreprocessed_cache_miss\ncache_miss\n# ../deps/v8/src/wasm/b.cc\npreprocessed_cache_hit\n'),{icu:{hits:1,misses:0},v8:{hits:1,misses:1},other:{hits:0,misses:0}});});
test('compiler cache preserves the clang++ symlink driver while hashing the real compiler',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'node-ccache-driver-')));
 try{
  const actual=join(root,'clang-20'),cc=join(root,'clang'),cxx=join(root,'clang++'),program=join(root,'ccache');
  await writeFile(actual,'exact compiler binary');await writeFile(program,'cache binary');await symlink(actual,cc);await symlink(actual,cxx);
  const result=await configureNodeCompilerCache({CC:cc,CXX:cxx,WASMFYI_NODE_CCACHE:program,WASMFYI_NODE_CCACHE_DIR:join(root,'objects')},{source:root,directory:root,run:async(binary,args)=>{assert.equal(binary,program);assert.deepEqual(args,['--version']);return {output:'ccache test\n'}}});
  assert.equal(result.env.CC,program+' '+cc);assert.equal(result.env.CXX,program+' '+cxx);
  assert.equal(result.provenance.compilers.CXX.path,actual);assert.equal(result.provenance.compilers.CXX.driverPath,cxx);
  assert.equal(result.provenance.compilers.CC.sha256,result.provenance.compilers.CXX.sha256);
 }finally{await rm(root,{recursive:true,force:true})}
});
