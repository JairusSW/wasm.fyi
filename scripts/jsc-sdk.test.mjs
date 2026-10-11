import {test} from 'node:test';
import assert from 'node:assert/strict';
import {javaScriptCorePort,javaScriptCoreICUFlags,javaScriptCoreRuntimeLinkFlags,verifyJavaScriptCoreICUBindings} from './lib/jsc-sdk.mjs';

test('ICU qualification rejects stale system libraries and ignored lowercase overrides',()=>{
 const cache=['ICU_INCLUDE_DIR:PATH=/private/icu/usr/include','ICU_UC_LIBRARY_RELEASE:FILEPATH=/private/icu/usr/lib/x86_64-linux-gnu/libicuuc.so','ICU_I18N_LIBRARY_RELEASE:FILEPATH=/private/icu/usr/lib/x86_64-linux-gnu/libicui18n.so','ICU_DATA_LIBRARY_RELEASE:FILEPATH=/private/icu/usr/lib/x86_64-linux-gnu/libicudata.so'].join('\n');
 verifyJavaScriptCoreICUBindings(cache,'/private/icu/usr');
 assert.throws(()=>verifyJavaScriptCoreICUBindings(cache.replace('ICU_UC_LIBRARY_RELEASE','ICU_uc_LIBRARY_RELEASE'),'/private/icu/usr'),/ICU_UC_LIBRARY_RELEASE/);
 assert.throws(()=>verifyJavaScriptCoreICUBindings(cache.replace('/private/icu/usr/lib/x86_64-linux-gnu/libicuuc.so','/usr/lib/x86_64-linux-gnu/libicuuc.so'),'/private/icu/usr'),/ICU_UC_LIBRARY_RELEASE/);
});

test('private ICU runtime keeps strict linking and assigns the loader only to executables',()=>{
 const original=['-DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=/sdk/lld','-DCMAKE_SHARED_LINKER_FLAGS=-L/sdk/lib'];
 const flags=javaScriptCoreRuntimeLinkFlags(original,{WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'/sdk/glibc'},'linux');
 for(const kind of ['EXE','SHARED','MODULE']){
  const value=flags.find(flag=>flag.startsWith('-DCMAKE_'+kind+'_LINKER_FLAGS='));
  assert.match(value,/\/sdk\/glibc\/libc.so.6/);assert.match(value,/--disable-new-dtags/);
  assert.equal(value.includes('--dynamic-linker'),kind==='EXE');
  assert.equal(value.includes('-Wl,--no-as-needed /sdk/glibc/ld-linux-x86-64.so.2 -Wl,--as-needed'),kind==='EXE');
  assert.doesNotMatch(value,/allow-shlib-undefined/);
 }
 assert.match(flags[0],/-fuse-ld=\/sdk\/lld/);
 assert.deepEqual(original,['-DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=/sdk/lld','-DCMAKE_SHARED_LINKER_FLAGS=-L/sdk/lib']);
 assert.equal(javaScriptCoreRuntimeLinkFlags(original,{},'linux'),original);
 assert.throws(()=>javaScriptCoreRuntimeLinkFlags(original,{WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'/unsafe dir'},'linux'),/Unsafe/);
});

test('private glibc headers stay coherent without replacing the chosen C++ ABI flags',()=>{
 const flags=javaScriptCoreRuntimeLinkFlags(['-DCMAKE_CXX_FLAGS=-stdlib=libc++ -nostdinc++'],{WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'/sdk/usr/lib/x86_64-linux-gnu'},'linux');
 const cpp=flags.find(flag=>flag.startsWith('-DCMAKE_CXX_FLAGS='));
 assert.match(cpp,/-stdlib=libc\+\+ -nostdinc\+\+/);
 for(const language of ['C','CXX'])assert.match(flags.find(flag=>flag.startsWith('-DCMAKE_'+language+'_FLAGS=')),/-isystem \/sdk\/usr\/include\/x86_64-linux-gnu -isystem \/sdk\/usr\/include/);
});

test('changing libc rechecks thread support without forcing an untested capability',()=>{
 const original=['-DCMAKE_CXX_FLAGS=-stdlib=libc++'];
 const flags=javaScriptCoreRuntimeLinkFlags(original,{WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'/sdk/usr/lib/x86_64-linux-gnu'},'linux');
 assert.ok(flags.includes('-UCMAKE_HAVE_LIBC_PTHREAD'));
 assert.ok(flags.includes('-UCMAKE_HAVE_PTHREADS_CREATE'));
 assert.ok(flags.includes('-UCMAKE_HAVE_PTHREAD_CREATE'));
 assert.ok(flags.includes('-UCMAKE_THREAD_LIBS_INIT'));
 assert.ok(!flags.some(flag=>flag.startsWith('-DCMAKE_HAVE_LIBC_PTHREAD=')));
 assert.equal(javaScriptCoreRuntimeLinkFlags(original,{},'linux'),original);
 assert.equal(javaScriptCoreRuntimeLinkFlags(original,{WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'/sdk/usr/lib/x86_64-linux-gnu'},'darwin'),original);
});

test('pins ICU headers and all linked ICU components to the same SDK',()=>{
 assert.deepEqual(javaScriptCoreICUFlags('/private/icu/usr'),[
  '-DICU_ROOT=/private/icu/usr','-DICU_INCLUDE_DIR=/private/icu/usr/include',
  '-DICU_UC_LIBRARY_RELEASE=/private/icu/usr/lib/x86_64-linux-gnu/libicuuc.so',
  '-DICU_I18N_LIBRARY_RELEASE=/private/icu/usr/lib/x86_64-linux-gnu/libicui18n.so',
  '-DICU_DATA_LIBRARY_RELEASE=/private/icu/usr/lib/x86_64-linux-gnu/libicudata.so'
 ]);
});

test('selects an accepted CMake port across the Mac to Cocoa transition',()=>{
 const release='set(ALL_PORTS\n GTK IOS JSCOnly Mac PlayStation WPE Win\n)';
 const main='set(ALL_PORTS\n Cocoa GTK IOS JSCOnly Mac PlayStation WPE Win\n)';
 assert.equal(javaScriptCorePort(release,true),'Mac');
 assert.equal(javaScriptCorePort(main,true),'Cocoa');
 assert.equal(javaScriptCorePort(release,false),'JSCOnly');
 assert.equal(javaScriptCorePort(main,false),'JSCOnly');
 assert.throws(()=>javaScriptCorePort('set(ALL_PORTS GTK WPE)',true),/does not support Mac/);
});


test('qualified dl archive search is scoped ahead of existing JSC library paths',()=>{
 const original=['-DCMAKE_EXE_LINKER_FLAGS=-L/other -fuse-ld=/sdk/lld'];
 const env={WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR:'/sdk/usr/lib/x86_64-linux-gnu',WASMFYI_JSC_DL_LINK_DIR:'/qualified/dl-only'};
 const flags=javaScriptCoreRuntimeLinkFlags(original,env,'linux');
 for(const kind of ['EXE','SHARED','MODULE']){
  const value=flags.find(flag=>flag.startsWith('-DCMAKE_'+kind+'_LINKER_FLAGS='));
  assert.ok(value.startsWith('-DCMAKE_'+kind+'_LINKER_FLAGS=-L/qualified/dl-only '));
  assert.doesNotMatch(value,/allow-shlib-undefined/);
 }
 assert.equal(javaScriptCoreRuntimeLinkFlags(original,env,'darwin'),original);
 assert.equal(javaScriptCoreRuntimeLinkFlags(original,{WASMFYI_JSC_DL_LINK_DIR:'/qualified/dl-only'},'linux'),original);
 assert.throws(()=>javaScriptCoreRuntimeLinkFlags(original,{...env,WASMFYI_JSC_DL_LINK_DIR:'/unsafe dir'},'linux'),/Unsafe/);
});
