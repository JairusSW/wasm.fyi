import {spiderMonkeyCbindgenEnvironment} from './spidermonkey-cbindgen.mjs';
import {mkdir,writeFile,readFile,stat,rm,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
import {availableParallelism} from 'node:os';
import {nodeBuildPython,nodeBuildEnvironment} from './node-build-python.mjs';
import {spiderMonkeyRustEnvironment} from './spidermonkey-rust.mjs';
import {repairSpiderMonkeyESR115} from './spidermonkey-esr115.mjs';
export function spiderMonkeyBuildEnvironment(env,platform=process.platform) {
 const explicitCompiler=platform==='linux'&&env.WASMFYI_SPIDERMONKEY_CXX;
 let selected=env;
 if(explicitCompiler){
  for(const path of [explicitCompiler,env.WASMFYI_SPIDERMONKEY_CC])if(!path||!path.startsWith('/')||/[\s"'$`]/.test(path))throw Error('Unsafe SpiderMonkey compiler path');
  // Older Mozilla sources need libstdc++'s generic char_traits specialization.
  // Keep the override local to this engine rather than changing the shared SDK.
  selected={...env,CC:env.WASMFYI_SPIDERMONKEY_CC,CXX:explicitCompiler,CXXFLAGS:env.WASMFYI_SPIDERMONKEY_CXXFLAGS??env.CXXFLAGS,WASMFYI_NODE_CXX_SDK:undefined,WASMFYI_WAVM_CXX_SDK:undefined};
 }
 const result=nodeBuildEnvironment(selected,platform);
 if(platform==='linux'&&env.WASMFYI_SPIDERMONKEY_CXX_RUNTIME){
  // Mozilla's sysroot C++ library may be newer than the host's. Bundle only
  // that library; mixing another libc with Mozilla's sysroot breaks probes.
  const prefix=env.WASMFYI_SPIDERMONKEY_CXX_RUNTIME;
  if(!prefix.startsWith('/')||/[\s"'`$]/.test(prefix))throw Error('Unsafe SpiderMonkey C++ runtime directory');
  result.LDFLAGS=[result.LDFLAGS,'-Wl,-rpath,'+prefix].filter(Boolean).join(' ');
 }
 // Mozilla splits all environment option values on commas, including Rust
 // flags. Forward each linker argument separately without losing ABI flags.
 if(result.RUSTFLAGS)result.RUSTFLAGS=result.RUSTFLAGS.replace(/(-C(?:\s+)?link-arg=)-Wl,([^\s]+)/g,(_,prefix,args)=>args.split(',').map(arg=>prefix+'-Xlinker '+prefix+arg).join(' '));
 if(platform==='darwin'&&env.WASMFYI_SPIDERMONKEY_CXX_SDK){
  const prefix=env.WASMFYI_SPIDERMONKEY_CXX_SDK;
  if(!prefix.startsWith('/')||/[\s"'$`]/.test(prefix))throw Error('Unsafe SpiderMonkey compiler SDK prefix');
  result.CC=result.HOST_CC=join(prefix,'bin/clang');result.CXX=result.HOST_CXX=join(prefix,'bin/clang++');
 }
 if(platform==='linux'&&(explicitCompiler||env.WASMFYI_WAVM_CXX_SDK)){
  // Keep Mozilla's -I system_wrappers ahead of the actual C++ headers.
  result.CXXFLAGS=(result.CXXFLAGS||'').replace('-I'+env.WASMFYI_WAVM_CXX_SDK+'/include/c++/v1','-isystem '+env.WASMFYI_WAVM_CXX_SDK+'/include/c++/v1');
  // Mozilla's configure feature probes invoke CXX directly without LDFLAGS.
  // Mozilla splits environment option values on commas before parsing the
  // compiler command. Forward linker arguments individually instead of -Wl,.
  const linkerFlags=(result.LDFLAGS||'').replace(/-Wl,([^\s]+)/g,(_,args)=>args.split(',').map(arg=>'-Xlinker '+arg).join(' '));
  result.CXX=result.CXX+' '+result.CXXFLAGS+' '+linkerFlags;
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
export function spiderMonkeyZlibEnvironment(env,minimumRust,platform=process.platform){
 const result={...env};
 // ESR115's bundled zlib mistakes modern TARGET_OS_MAC for classic Mac OS
 // and defines fdopen before SDK26's stdio declaration. Include the system
 // declaration first, independently of the Rust/linker compatibility policy.
 if(platform==='darwin'&&minimumRust==='1.66.0'&&!/(?:^|\s)-include\s+stdio\.h(?:\s|$)/.test(result.CFLAGS||''))result.CFLAGS=((result.CFLAGS||'')+' -include stdio.h').trim();
 return result;
}
export function spiderMonkeyPythonEnvironment(env,minimumRust,platform=process.platform){
 const python=env.WASMFYI_SPIDERMONKEY_LEGACY_PYTHON;
 if(platform!=='linux'||minimumRust!=='1.66.0'||!python)return {...env};
 if(!python.startsWith('/')||/[\s"'$`]/.test(python))throw Error('Unsafe legacy SpiderMonkey Python path');
 // ESR 115's virtualenv implementation predates Python 3.12 and assumes its
 // sysconfig data directory is the virtualenv root. Use an explicitly
 // qualified older host interpreter for this source family only.
 return {...env,WASMFYI_BUILD_PYTHON:python};
}
export async function resetSpiderMonkeyCompilerCache(object,env){
 const status=await readFile(join(object,'config.status'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error});
 const previous=status.match(/['"]_CXX['"]:\s*['"]([^'"]+)['"]/)?.[1];
 const selected=env.CXX?.split(/\s+/)[0];
 const missingStdio=/(?:^|\s)-include\s+stdio\.h(?:\s|$)/.test(env.CFLAGS||'')&&!/['"]-include['"],\s*['"]stdio\.h['"]/.test(status);
 if(!status||!missingStdio&&(!previous||!selected||previous===selected))return false;
 // Mozilla reuses config.status even after CXX changes. Mixing objects from
 // different libc++ headers is unsafe, so clobber this SDK's objects only.
 await rm(object,{recursive:true,force:true});return true;
}
export async function repairSpiderMonkeyLinuxSingleThreadedWrapper(source,platform=process.platform){
 if(platform!=='linux')return null;
 const path=join(source,'config/system-headers.mozbuild'),header='    "sys/single_threaded.h",\n';
 const current=await readFile(path,'utf8');
 if(!current.includes(header))return null;
 if(current.split(header).length!==2)throw Error('Ambiguous SpiderMonkey single_threaded system-header declaration');
 const corrected=current.replace(header,'');await writeFile(path,corrected);
 return {path,originalSha256:digest(Buffer.from(current)),compiledSha256:digest(Buffer.from(corrected)),policy:'Let the selected Linux sysroot answer __has_include directly; a generated wrapper makes missing sys/single_threaded.h look present and then fail include_next'};
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
 const sourceCompatibility=await repairSpiderMonkeyESR115(source,minimumRust,env);
 const linuxSingleThreadedWrapper=await repairSpiderMonkeyLinuxSingleThreadedWrapper(source);
 if(linuxSingleThreadedWrapper)await rm(object,{recursive:true,force:true});
 const bindgenPolicy=await readFile(join(source,'build/moz.configure/bindgen.configure'),'utf8').catch(()=>'');
 const minimumCbindgen=bindgenPolicy.match(/cbindgen_min_version\s*=\s*Version\("([^"]+)"\)/)?.[1];
 const cxxRuntime=await stageSpiderMonkeyCxxRuntime(target,env);
 const selectedEnv=cxxRuntime?{...env,WASMFYI_SPIDERMONKEY_CXX_RUNTIME:cxxRuntime.directory}:env;
 const buildEnv=spiderMonkeyPythonEnvironment(spiderMonkeyCbindgenEnvironment(spiderMonkeyZlibEnvironment(spiderMonkeyLegacyLinkerEnvironment({...spiderMonkeyRustEnvironment(spiderMonkeyBuildEnvironment(selectedEnv),minimumRust),MOZCONFIG:mozconfig},minimumRust),minimumRust),minimumRust,minimumCbindgen),minimumRust);
 if(buildEnv.CC?.includes('-fuse-ld=/Library/Developer/CommandLineTools/usr/bin/ld-classic')&&!await stat('/Library/Developer/CommandLineTools/usr/bin/ld-classic').catch(()=>null))throw Error('Legacy SpiderMonkey requires installed Apple ld-classic');
 const python=await nodeBuildPython(buildEnv,run,'SpiderMonkey',minimumRust==='1.66.0'?8:10);
 await resetSpiderMonkeyCompilerCache(object,buildEnv);
 await run(python.program,[join(source,'mach'),'build','--jobs',String(env.WASMFYI_BUILD_JOBS||availableParallelism())],{cwd:source,env:buildEnv});
 const binary=join(object,'dist/bin/js');if(!await stat(binary).catch(()=>null))throw Error('SpiderMonkey source build did not produce its shell');
 await run(binary,['--wasm-compiler=ion','-e','if(!wasmIsSupported())throw Error("WebAssembly disabled")']);
 env.WASMBENCH_SPIDERMONKEY=binary;env.NODE_OPTIONS='';
 return {source,target,binary,binarySha256:digest(await readFile(binary)),flags,python,rustToolchain:buildEnv.RUSTUP_TOOLCHAIN||null,minimumRust,sourceCompatibility,linuxSingleThreadedWrapper,...(cxxRuntime?{cxxRuntime}:{}),mozconfigSha256:digest(await readFile(mozconfig)),wasmCompiler:'Ion only'};
}
export async function stageSpiderMonkeyCxxRuntime(target,env,platform=process.platform){
 if(platform!=='linux'||!env.WASMFYI_SPIDERMONKEY_CXX_RUNTIME)return null;
 const prefix=env.WASMFYI_SPIDERMONKEY_CXX_RUNTIME;
 if(!prefix.startsWith('/')||/[\s"'`$]/.test(prefix))throw Error('Unsafe SpiderMonkey C++ runtime directory');
 const source=join(prefix,'libstdc++.so.6'),directory=join(target,'runtime'),path=join(directory,'libstdc++.so.6');
 await mkdir(directory,{recursive:true});await copyFile(source,path);
 return {source,directory,path,sha256:digest(await readFile(path))};
}
