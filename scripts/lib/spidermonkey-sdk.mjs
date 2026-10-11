import {spiderMonkeyCbindgenEnvironment} from './spidermonkey-cbindgen.mjs';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
import {availableParallelism} from 'node:os';
import {nodeBuildPython,nodeBuildEnvironment} from './node-build-python.mjs';
import {spiderMonkeyRustEnvironment} from './spidermonkey-rust.mjs';
export function spiderMonkeyBuildEnvironment(env) {
 const result=nodeBuildEnvironment(env);
 if(env.WASMFYI_WAVM_CXX_SDK){
  // Keep Mozilla's -I system_wrappers ahead of the actual C++ headers.
  result.CXXFLAGS=result.CXXFLAGS.replace('-I'+env.WASMFYI_WAVM_CXX_SDK+'/include/c++/v1','-isystem '+env.WASMFYI_WAVM_CXX_SDK+'/include/c++/v1');
  // Mozilla's configure feature probes invoke CXX directly without LDFLAGS.
  result.CXX=result.CXX+' '+result.CXXFLAGS+' '+result.LDFLAGS;
  result.HOST_CXX=result.CXX;
  result.HOST_CC=result.CC;
 }
 return result;
}
export function spiderMonkeyLegacyLinkerEnvironment(env,minimumRust,platform=process.platform) {
 // ESR 115's linker probe recognizes classic ld64's diagnostic, which the
 // SDK 26 linker removed. Keep newer sources and other platforms unchanged.
 if(platform!=='darwin'||minimumRust!=='1.66.0'||!env.WASMFYI_SPIDERMONKEY_LEGACY_RUST)return {...env};
 const result={...env},linker='/Library/Developer/CommandLineTools/usr/bin/ld-classic';
 result.INSTALL_NAME_TOOL='/Library/Developer/CommandLineTools/usr/bin/install_name_tool';
 // The legacy zlib macro precedes Darwin stdio declarations; preinclude preserves upstream source.
 if(env.WASMFYI_SPIDERMONKEY_LEGACY_CLANG)result.CFLAGS=((result.CFLAGS||'')+' -include stdio.h').trim();
 const compiler=env.WASMFYI_SPIDERMONKEY_LEGACY_CLANG;
 if(compiler){
  if(!compiler.startsWith('/')||/[\s\"'$`]/.test(compiler))throw Error('Unsafe legacy SpiderMonkey compiler directory');
  for(const name of ['CC','CXX','HOST_CC','HOST_CXX'])result[name]=compiler+((name==='CXX'||name==='HOST_CXX')?'/clang++':'/clang');
 }

 for(const name of ['CC','CXX','HOST_CC','HOST_CXX'])result[name]=(result[name]||((name==='CXX'||name==='HOST_CXX')?'/usr/bin/clang++':'/usr/bin/clang'))+' -fuse-ld='+linker;
 return result;
}
export async function buildSpiderMonkeySDK({source,target,env,run}) {
 await mkdir(target,{recursive:true});
 const object=join(target,'obj'),mozconfig=join(target,'mozconfig');
 const flags=['--enable-project=js','--enable-optimize','--disable-debug','--enable-release','--disable-tests'];
 for(const [name,value]of [['--with-libclang-path',env.WASMFYI_SPIDERMONKEY_LIBCLANG],['--with-clang-path',env.WASMFYI_SPIDERMONKEY_BINDGEN_CLANG]]){if(value){if(!value.startsWith('/')||/[\n\r\"$`\s]/.test(value))throw Error('Unsafe SpiderMonkey bindgen tool path');flags.push(name+'='+value);}}
 if(/[\n\r"$`]/.test(object))throw Error('Unsafe SpiderMonkey build path');
 await writeFile(mozconfig,['mk_add_options MOZ_OBJDIR="'+object+'"',...flags.map(flag=>'ac_add_options '+flag),''].join('\n'));
 const rustPolicy=await readFile(join(source,'python/mozboot/mozboot/util.py'),'utf8');
 const minimumRust=rustPolicy.match(/^MINIMUM_RUST_VERSION\s*=\s*["']([^"']+)["']/m)?.[1];
 if(env.WASMFYI_SPIDERMONKEY_LEGACY_RUST&&!minimumRust)throw Error('Pinned SpiderMonkey Rust minimum unavailable');
 const bindgenPolicy=await readFile(join(source,'build/moz.configure/bindgen.configure'),'utf8').catch(()=>'');
 const minimumCbindgen=bindgenPolicy.match(/cbindgen_min_version\s*=\s*Version\("([^"]+)"\)/)?.[1];
 const buildEnv=spiderMonkeyCbindgenEnvironment(spiderMonkeyLegacyLinkerEnvironment({...spiderMonkeyRustEnvironment(spiderMonkeyBuildEnvironment(env),minimumRust),MOZCONFIG:mozconfig},minimumRust),minimumRust,minimumCbindgen);
 if(buildEnv.CC?.includes('-fuse-ld=/Library/Developer/CommandLineTools/usr/bin/ld-classic')&&!await stat('/Library/Developer/CommandLineTools/usr/bin/ld-classic').catch(()=>null))throw Error('Legacy SpiderMonkey requires installed Apple ld-classic');
 const python=await nodeBuildPython(buildEnv,run,'SpiderMonkey');
 await run(python.program,[join(source,'mach'),'build','--jobs',String(env.WASMFYI_BUILD_JOBS||availableParallelism())],{cwd:source,env:buildEnv});
 const binary=join(object,'dist/bin/js');if(!await stat(binary).catch(()=>null))throw Error('SpiderMonkey source build did not produce its shell');
 await run(binary,['--wasm-compiler=ion','-e','if(!wasmIsSupported())throw Error("WebAssembly disabled")']);
 env.WASMBENCH_SPIDERMONKEY=binary;env.NODE_OPTIONS='';
 return {source,target,binary,binarySha256:digest(await readFile(binary)),flags,python,rustToolchain:buildEnv.RUSTUP_TOOLCHAIN||null,minimumRust,mozconfigSha256:digest(await readFile(mozconfig)),wasmCompiler:'Ion only'};
}
