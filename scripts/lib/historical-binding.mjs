import {readFile,writeFile,mkdir,cp,readdir,symlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {command,digest,exists} from './wasmbench.mjs';
import {releaseSource,assertReleasedSource,releaseCache,githubReleases} from './release-policy.mjs';

export function pendingBindingReason(pin) {
  return pin.targetType==='main' ? 'No source-revision performance build binding has been qualified for this engine yet.' : null;
}

export function engineVersion(pin) {
  if(pin.engine==='wavm')return pin.tag;
  if(pin.engine==='spidermonkey')return pin.tag;
  const version=pin.engine==='jsc'?pin.tag.replace(/^webkitgtk-/,''):pin.tag.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0];
  if(!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))throw Error('Release needs an explicit SDK version mapping: '+pin.tag);
  return version;
}

async function webkitReleaseSource(tag) {
  // WebKitGTK source tarballs omit the Git-backed build scripts and Mac port
  // files. The corresponding upstream tag is the reproducible source for JSC
  // on both benchmark hosts.
  const repository='WebKit/WebKit',url=`https://github.com/${repository}.git`;
  const source=join(releaseCache(),repository.replace('/','-'),`${tag}-git`);
  await mkdir(dirname(source),{recursive:true});
  if(!await exists(join(source,'.git'))) {
    command('git',['init',source]);
    command('git',['-C',source,'remote','add','origin',url]);
  }
  if(command('git',['-C',source,'remote','get-url','origin']).toString().trim()!==url)
    throw Error('WebKit release checkout remote differs');
  if(command('git',['-C',source,'status','--porcelain','--untracked-files=no']).toString())
    throw Error('WebKit release checkout contains tracked changes: '+source);
  command('git',['-C',source,'fetch','--depth','1','--filter=blob:none','origin',`refs/tags/${tag}`]);
  const revision=command('git',['-C',source,'rev-parse','FETCH_HEAD^{commit}']).toString().trim();
  const receipt=join(source,'.git/wasm-fyi-release.json');
  if(await exists(receipt) && JSON.parse(await readFile(receipt)).revision!==revision)
    throw Error('Published WebKit release tag moved: '+tag);
  command('git',['-C',source,'checkout','--detach',revision]);
  command('git',['-C',source,'sparse-checkout','init','--cone']);
  command('git',['-C',source,'sparse-checkout','set','Configurations','Source','Tools/Scripts','Tools/TestWebKitAPI','Tools/clangd','WebKitLibraries']);
  await writeFile(receipt,JSON.stringify({repository,tag,revision,url})+'\n');
  return {repository,tag,revision,url,source};
}

export async function copyHistoricalHarness(base,root) {
  if(await exists(root))throw Error('Historical build directory already exists: '+root);
  await mkdir(dirname(root),{recursive:true});
  // Historical hosts may keep this isolated harness in a shallow partial
  // clone whose promisor remote is unavailable. A build needs its checked-out
  // source tree and pinned SDKs, not a duplicate Git object database.
  await mkdir(root,{recursive:false});
  const files=command('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:base}).toString().split('\0').filter(Boolean);
  for(const path of files) {
    if(path.startsWith('/') || path.split('/').includes('..'))throw Error('Unsafe harness input: '+path);
    await mkdir(dirname(join(root,path)),{recursive:true});
    await cp(join(base,path),join(root,path),{dereference:true});
  }
  // Keep independent artifact admission fixed while changing the measured SDK.
  const analyzer='adapters/wasmtime/target/release/wasm-analyze';
  if(!await exists(join(base,analyzer))) {
    // Remote stages transfer source, not ignored Cargo outputs. Build the
    // current pinned analyzer once on that measurement host so every
    // historical adapter uses the same independent admission policy.
    command('cargo',['build','--release','--locked','--manifest-path',join(base,'adapters/wasmtime/Cargo.toml'),'--bin','wasm-analyze'],{cwd:base,stdio:'inherit'});
  }
  await mkdir(dirname(join(root,analyzer)),{recursive:true});
  await cp(join(base,analyzer),join(root,analyzer));
  // `base` is the exact, already-qualified harness checkout selected by the
  // current data run. It may contain deliberate uncommitted adapter changes
  // and newer equivalents of the historical patch series. Reapplying that
  // older patch stack here rejects the current source or duplicates its
  // behavior. Preserve the copied source verbatim; the per-runtime release
  // binding below changes only the selected SDK/runtime input.
}

export async function buildHistoricalBinding({root,pin,configuration,invoke,env}) {
  if(!pin.configurations.includes(configuration))throw Error('Configuration is not part of this release job');
  const version=engineVersion(pin);
  const replace=async(path,old,value)=>{
    const file=join(root,path),source=await readFile(file,'utf8');
    if(!source.includes(old))throw Error('Historical adapter version anchor missing: '+path);
    await writeFile(file,source.replaceAll(old,value));
  };
  const replaceSourceTree=async(directory,extension,old)=>{
    for(const entry of await readdir(join(root,directory),{withFileTypes:true})) {
      const path=join(directory,entry.name);
      if(entry.isDirectory())await replaceSourceTree(path,extension,old);
      else if(path.endsWith(extension)) {
        const source=await readFile(join(root,path),'utf8');
        if(source.includes(old))await writeFile(join(root,path),source.replaceAll(old,version));
      }
    }
  };
  const cargoReceipt=async(path,name)=>{
    const lock=await readFile(join(root,path),'utf8');
    const packages=lock.split('[[package]]').filter(block=>new RegExp('(?:^|\\n)name = "'+name+'"(?:\\n|$)').test(block));
    if(packages.length!==1 || !packages[0].includes('version = "'+version+'"'))throw Error('Historical Cargo SDK differs from its selected release');
    return {sdk:name,version,lockSha256:digest(lock)};
  };
  let source;
  if(pin.engine==='v8') {
    const target=join(root,'toolchains','node-'+version),archiveName=`node-${pin.tag}-${process.platform==='darwin'?'darwin':'linux'}-${process.arch}.tar.xz`;
    if(!['darwin-arm64','linux-x64'].includes(`${process.platform}-${process.arch}`))throw Error('No qualified Node release archive for '+process.platform+'/'+process.arch);
    const archive=join(root,'toolchains',archiveName),checksums=join(root,'toolchains','SHASUMS256-'+version+'.txt');
    await mkdir(join(root,'toolchains'),{recursive:true});
    command('curl',['--fail','--location','--retry','3','--max-time','600',`https://nodejs.org/dist/${pin.tag}/${archiveName}`,'-o',archive],{timeout:10*60*1000});
    command('curl',['--fail','--location','--retry','3','--max-time','120',`https://nodejs.org/dist/${pin.tag}/SHASUMS256.txt`,'-o',checksums],{timeout:3*60*1000});
    const line=(await readFile(checksums,'utf8')).split(/\r?\n/).find(item=>item.trim().endsWith('  '+archiveName));
    if(!line)throw Error('Official Node SHA256 manifest does not contain '+archiveName);
    const archiveSha256=line.trim().split(/\s+/)[0];
    if(digest(await readFile(archive))!==archiveSha256)throw Error('Official Node release archive checksum mismatch');
    await mkdir(target,{recursive:true});
    command('tar',['-xJf',archive,'--strip-components=1','-C',target],{timeout:10*60*1000});
    const node=join(target,'bin','node'),nodeVersion=command(node,['-p','process.versions.node']).toString().trim(),embeddedV8=command(node,['-p','process.versions.v8']).toString().trim();
    if(nodeVersion!==version||!/^\d+\.\d+\.\d+/.test(embeddedV8))throw Error(`Node/V8 release identity mismatch: node ${nodeVersion}, V8 ${embeddedV8}`);
    env.WASMBENCH_NODE=node;env.NODE_OPTIONS='';
    source={nodeVersion,embeddedV8,plannedEmbeddedV8:pin.embeddedV8||null,archiveName,archiveSha256,nodeSha256:digest(await readFile(node)),checksumManifest:'https://nodejs.org/dist/'+pin.tag+'/SHASUMS256.txt'};
  } else if(pin.engine==='deno') {
    const assetName=process.platform==='darwin'&&process.arch==='arm64'?'deno-aarch64-apple-darwin.zip':process.platform==='linux'&&process.arch==='x64'?'deno-x86_64-unknown-linux-gnu.zip':null;
    if(!assetName)throw Error('No qualified Deno release asset for '+process.platform+'/'+process.arch);
    const release=JSON.parse(command('gh',['api',`repos/${pin.repository}/releases/tags/${pin.tag}`]).toString());
    const asset=release.assets?.find(item=>item.name===assetName),expected=asset?.digest?.replace(/^sha256:/,'');
    if(!asset?.browser_download_url||!/^[a-f0-9]{64}$/.test(expected||''))throw Error('Deno release has no qualified SHA-256 asset receipt: '+assetName);
    const archive=join(root,'toolchains',assetName),target=join(root,'toolchains','deno-'+version);
    await mkdir(join(root,'toolchains'),{recursive:true});
    command('curl',['--fail','--location','--retry','3','--max-time','600',asset.browser_download_url,'-o',archive],{timeout:10*60*1000});
    const archiveSha256=digest(await readFile(archive));if(archiveSha256!==expected)throw Error('Official Deno release archive checksum mismatch');
    await mkdir(target,{recursive:true});command('unzip',['-oq',archive,'-d',target],{timeout:3*60*1000});
    const deno=join(target,'deno');if(!await exists(deno))throw Error('Deno release archive did not contain the deno executable');
    command('chmod',['+x',deno]);
    const description=JSON.parse(command(deno,['eval','--no-config','console.log(JSON.stringify(Deno.version))']).toString().trim());
    if(description.deno!==version||!description.v8)throw Error('Deno binary identity differs from its release tag');
    env.WASMBENCH_DENO=deno;env.NODE_OPTIONS='';
    source={assetName,assetUrl:asset.browser_download_url,archiveSha256,denoSha256:digest(await readFile(deno)),denoVersion:description.deno,v8Version:description.v8};
  } else if(pin.engine==='wago') {
    source=await releaseSource(pin.repository,{tag:pin.tag});
    if(source.publishedAt!==pin.publishedAt)throw Error('Wago publication metadata changed since planning');
    assertReleasedSource(source.source,source);
    invoke('build','--runtimes',configuration,'--wago-source',source.source);
    assertReleasedSource(source.source,source);
  } else if(pin.engine==='wazero') {
    await replaceSourceTree('adapters/wazero','.go','1.12.0');
    // The controller and its oracle keep their original module graph. Only the
    // adapter gets the historical dependency, using a separate Go modfile.
    const mod=join(root,'historical-wazero.mod');
    await cp(join(root,'go.mod'),mod);await cp(join(root,'go.sum'),mod.replace(/\.mod$/,'.sum'));
    command('go',['mod','edit','-modfile='+mod,'-require=github.com/tetratelabs/wazero@'+pin.tag],{cwd:root,env});
    const receipt=JSON.parse(command('go',['mod','download','-json','github.com/tetratelabs/wazero@'+pin.tag],{cwd:root,env}).toString());
    if(receipt.Version!==pin.tag || !receipt.Sum)throw Error('Historical wazero module identity differs');
    command('go',['build','-mod=mod','-modfile='+mod,'-trimpath','-o',join(root,'bin/adapter-wazero'),'./adapters/wazero'],{cwd:root,env,stdio:'inherit'});
    const info=command('go',['version','-m',join(root,'bin/adapter-wazero')],{env}).toString();
    if(!info.includes('github.com/tetratelabs/wazero\t'+pin.tag+'\t'+receipt.Sum))throw Error('Built wazero adapter has a different module graph');
    source={module:'github.com/tetratelabs/wazero',version:receipt.Version,sum:receipt.Sum,goModSum:receipt.GoModSum};
  } else if(pin.engine==='wasmtime') {
    await replace('adapters/wasmtime/Cargo.toml','=46.0.1','='+version);
    await replaceSourceTree('adapters/wasmtime/src','.rs','46.0.1');
    const major=Number(version.split('.')[0]);
    let compatibilityPatch=null;
    if(major===36) {
      await replace('adapters/wasmtime/Cargo.toml','features = ["p1"]','features = ["preview1"]');
      const files=[];
      const patchOldApi=async directory=>{
        for(const entry of await readdir(join(root,directory),{withFileTypes:true})) {
          const path=join(directory,entry.name);
          if(entry.isDirectory())await patchOldApi(path);
          else if(path.endsWith('.rs')) {
            let text=await readFile(join(root,path),'utf8');
            text=text.replaceAll('wasmtime_wasi::p1','wasmtime_wasi::preview1').replaceAll('p1::{self','preview1::{self')
              .replaceAll('wasmtime::bail!','anyhow::bail!').replaceAll('wasmtime::ensure!','anyhow::ensure!')
              .replaceAll('wasmtime::format_err!','anyhow::anyhow!');
            text=text.replace(/use wasmtime::\{[^;]*\};/gs,clause=>clause
              .replace(/([,{])\s*(?:bail|ensure|format_err(?:\s+as\s+\w+)?)\s*,/g,'$1')
              .replace(/,\s*(?:bail|ensure|format_err(?:\s+as\s+\w+)?)\s*(?=})/g,'')
              .replace(/\{\s*}/g,'{}'));
            text=text.replace(/use wasmtime::(?:bail|ensure|format_err(?:\s+as\s+\w+)?)\s*;/g,'')
              .replace(/(?<!:)\bbail!/g,'anyhow::bail!').replace(/(?<!:)\bensure!/g,'anyhow::ensure!')
              .replace(/(?<!:)\bformat_err!/g,'anyhow::anyhow!').replace(/(?<![:\w])anyhow!/g,'anyhow::anyhow!')
              .replace('preview1::{self,','preview1::{self as p1,')
              .replace('use crate::{Result, Val, Value, anyhow, bail, bits};','use crate::{Result, Val, Value, bits};');
            await writeFile(join(root,path),text);files.push(path);
          }
        }
      };
      await patchOldApi('adapters/wasmtime/src');
      await writeFile(join(root,'adapters/wasmtime/src/features.rs'),
        'use serde_json::{Value,json};\nuse wasmtime::Config;\n'+
        'pub fn configure(config:&mut Config,winch:bool){config.wasm_tail_call(!winch);config.wasm_relaxed_simd(!winch);config.wasm_exceptions(false);config.wasm_legacy_exceptions(false);if winch&&cfg!(target_arch="aarch64"){config.wasm_simd(false);}}\n'+
        'pub fn describe(winch:bool)->Value{json!({"namespace":"Wasmtime 36 Config defaults","enabled":{"TAIL_CALL":!winch,"RELAXED_SIMD":!winch,"SIMD":!(winch&&cfg!(target_arch="aarch64"))},"disabled":["GC","FUNCTION_REFERENCES","THREADS","STACK_SWITCHING","CM_ASYNC","CM_ASYNC_STACKFUL"]})}\n');
      await writeFile(join(root,'adapters/wasmtime/src/component_calls.rs'),
        'use serde_json::{Value,json};\nuse wasmtime::{Engine,Result};\n'+
        'pub const POLICY:&str="component-u64-v1";pub const BOUNDARIES:&str="not measured: features held";\n'+
        'pub fn validate(_: &Value)->Result<()>{Ok(())}\n'+
        'pub fn run(_: &Engine,_:&[u8],_:&Value,_:&Value,_:&mut dyn FnMut(u64,&str)->Result<()>)->Result<Value>{Ok(json!({"status":"unsupported","reason":"historical Component Model features held"}))}\n');
      await writeFile(join(root,'adapters/wasmtime/src/components.rs'),
        'use serde_json::{Value,json};\nuse wasmtime::{Engine,Result};\n'+
        'pub fn validate_workload(_: &Value)->Result<()>{Ok(())}\n'+
        'pub fn run(_: &Engine,_:&[u8],_:&Value,_:&Value)->Result<Value>{Ok(json!({"status":"unsupported","reason":"historical Component Model features held"}))}\n');
      compatibilityPatch={adapterApi:'Wasmtime 36',wasiPreview1Feature:'preview1',components:'excluded from this feature-held suite',filesSha256:digest(JSON.stringify(await Promise.all(files.map(async path=>[path,digest(await readFile(join(root,path)))]))))};
    }
    if(major>=48) {
      await replace('adapters/wasmtime/src/commands.rs',
        'use wasmtime_wasi::{DirPerms, FilePerms, I32Exit, WasiCtxBuilder};',
        'use wasmtime_wasi::{FsPerms, I32Exit, WasiCtxBuilder};');
      await replace('adapters/wasmtime/src/commands.rs',
        'builder.preopened_dir(dir.path(), "/", DirPerms::READ, FilePerms::READ)?;',
        'builder.preopened_dir(dir.path(), "/", FsPerms::ReadOnly)?;');
      await replace('adapters/wasmtime/src/p2commands.rs',
        '    DirPerms, FilePerms, WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView,',
        '    FsPerms, WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView,');
      await replace('adapters/wasmtime/src/p2commands.rs',
        '            let dir_perms = if writable {\n                DirPerms::all()\n            } else {\n                DirPerms::READ\n            };\n            let file_perms = if writable {\n                FilePerms::all()\n            } else {\n                FilePerms::READ\n            };\n            builder.preopened_dir(staging.path(), "/", dir_perms, file_perms)?;',
        '            let perms = if writable { FsPerms::ReadWrite } else { FsPerms::ReadOnly };\n            builder.preopened_dir(staging.path(), "/", perms)?;');
    }
    command('cargo',['update','--manifest-path',join(root,'adapters/wasmtime/Cargo.toml'),'-p','wasmtime','--precise',version],{cwd:root,env,stdio:'inherit'});
    invoke('build','--runtimes',configuration);
    source={...await cargoReceipt('adapters/wasmtime/Cargo.lock','wasmtime'),compatibilityPatch};
  } else if(pin.engine==='wasmi') {
    await replace('adapters/native/Cargo.toml','=2.0.0','='+version);
    await replace('adapters/native/src/wasmi.rs','2.0.0',version);
    command('cargo',['update','--manifest-path',join(root,'adapters/native/Cargo.toml'),'-p','wasmi','--precise',version],{cwd:root,env,stdio:'inherit'});
    invoke('build','--runtimes',configuration);
    source=await cargoReceipt('adapters/native/Cargo.lock','wasmi');
  } else if(pin.engine==='wasm3'||pin.engine==='wamr') {
    source=await releaseSource(pin.repository,{tag:pin.tag});assertReleasedSource(source.source,source);
    const sdk=join(root,'toolchains',`${pin.engine}-${version}`);await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
    if(pin.engine==='wasm3'){
      const build=join(root,'toolchains',`wasm3-build-${version}`);
      // The tagged release keeps its project-level CMake file at the root;
      // `source/` contains the static library subdirectory.
      command('cmake',['-S',source.source,'-B',build,'-DCMAKE_BUILD_TYPE=Release','-DBUILD_WASI=none'],{stdio:'inherit'});
      command('cmake',['--build',build,'--target','m3','-j','4'],{stdio:'inherit'});
      for(const name of await readdir(join(source.source,'source')))if(name.endsWith('.h'))await cp(join(source.source,'source',name),join(sdk,'include',name));
      await cp(join(build,'source','libm3.a'),join(sdk,'lib','libm3.a'));
      env.WASMBENCH_WASM3_SDK=sdk;env.WASMBENCH_WASM3_VERSION=version;
    } else {
      const build=join(root,'toolchains',`wamr-build-${version}`),flags=['-DCMAKE_BUILD_TYPE=Release','-DWAMR_BUILD_AOT=0','-DWAMR_DISABLE_STACK_HW_BOUND_CHECK=1','-DWAMR_BUILD_FAST_INTERP=0','-DWAMR_BUILD_GC=1','-DWAMR_BUILD_EXCE_HANDLING=1','-DWAMR_BUILD_LIBC_WASI=0','-DWAMR_BUILD_LIBC_BUILTIN=0','-DBUILD_SHARED_LIBS=ON'];
      command('cmake',['-S',join(source.source,'product-mini','platforms',process.platform),'-B',build,...flags],{stdio:'inherit'});
      command('cmake',['--build',build,'--target','vmlib','-j','4'],{stdio:'inherit'});
      for(const name of await readdir(join(source.source,'core','iwasm','include')))if(name.endsWith('.h'))await cp(join(source.source,'core','iwasm','include',name),join(sdk,'include',name));
      const library=(await readdir(build)).find(name=>/^libiwasm.*\.(?:dylib|so)(?:\.[\d.]+)?$/.test(name));
      if(!library)throw Error('WAMR release build did not produce its shared runtime library');
      await cp(join(build,library),join(sdk,'lib',library),{dereference:true});
      const linkerName=process.platform==='darwin'?'libiwasm.dylib':'libiwasm.so';
      if(library!==linkerName)await symlink(library,join(sdk,'lib',linkerName));
      env.WASMBENCH_WAMR_SDK=sdk;env.WASMBENCH_WAMR_VERSION=version;
    }
    invoke('build','--runtimes',configuration);
    source={...source,version,sdk,buildFlags:pin.engine==='wamr'?['Release','classic interpreter','GC','exceptions','software stack bounds']:['Release','WASI disabled']};
  } else if(pin.engine==='jsc') {
    const upstream=await webkitReleaseSource(pin.tag),sourceRoot=upstream.source;
    let build,jsc,builder;
    if(process.platform==='darwin'&&process.arch==='arm64') {
      const sdk=command('xcrun',['--sdk','macosx','--show-sdk-path']).toString().trim();
      build=join(sourceRoot,'WebKitBuild','MacJSCOnly','Release');
      const cmakeArgs=['-S',sourceRoot,'-B',build,'-G','Ninja','-DPORT=Mac','-DCMAKE_BUILD_TYPE=Release',`-DCMAKE_OSX_SYSROOT=${sdk}`,
        '-DENABLE_API_TESTS=OFF','-DENABLE_WEBKIT=OFF','-DENABLE_WEBKIT_LEGACY=OFF','-DENABLE_WEBKIT_TEST_RUNNER=OFF','-DENABLE_MINIBROWSER=OFF','-DENABLE_JAVASCRIPTCORE=ON'];
      command('cmake',cmakeArgs,{timeout:30*60*1000});
      command('cmake',['--build',build,'--target','jsc','-j','4'],{timeout:6*60*60*1000});
      jsc=join(build,'jsc');builder=['cmake',...cmakeArgs,'--build','<build>','--target','jsc','-j','4'];
      env.DYLD_FRAMEWORK_PATH=[build,env.DYLD_FRAMEWORK_PATH].filter(Boolean).join(':');
    } else {
      if(!['darwin-arm64','linux-x64'].includes(`${process.platform}-${process.arch}`))
        throw Error('No qualified WebKit JSC build for '+process.platform+'/'+process.arch);
      const script=join(sourceRoot,'Tools','Scripts','build-webkit');
      builder=[script,'--jsc-only','--release'];
      const buildEnv={...env};
      // The Hub has no system Ruby package. Use the isolated Ruby runtime
      // prepared for this host, and keep it scoped to WebKit build steps.
      const rubyRoot=join(dirname(releaseCache()),'toolchains','ruby-3.2-local');
      if(await exists(join(rubyRoot,'bin','ruby'))) {
        buildEnv.PATH=[join(rubyRoot,'bin'),buildEnv.PATH].filter(Boolean).join(':');
        buildEnv.LD_LIBRARY_PATH=[join(rubyRoot,'root/usr/lib/x86_64-linux-gnu'),buildEnv.LD_LIBRARY_PATH].filter(Boolean).join(':');
        buildEnv.RUBYLIB=[join(rubyRoot,'root/usr/lib/ruby/3.2.0'),join(rubyRoot,'root/usr/lib/x86_64-linux-gnu/ruby/3.2.0'),buildEnv.RUBYLIB].filter(Boolean).join(':');
      }
      const cmakeArgs=['-DENABLE_API_TESTS=OFF',...(process.platform==='linux'?['-DCMAKE_CXX_FLAGS=-Wno-error=unused-const-variable']:[])];
      builder.push('--cmakeargs='+cmakeArgs.join(' '));
      try {
        command('perl',builder,{cwd:sourceRoot,env:buildEnv,stdio:'inherit',timeout:6*60*60*1000});
      } catch(error) {
        // WebKitGTK 2.54.1's Unix Makefiles link JavaScriptCore against
        // JavaScriptCoreJIT objects without ordering that object target
        // first. Build that target explicitly, then retry the now-incremental
        // upstream build. Genuine compile/link errors still fail the retry.
        if(process.platform!=='linux'||!/^perl failed \(2\)$/.test(error.message))throw error;
        build=join(sourceRoot,'WebKitBuild','JSCOnly','Release');
        command('cmake',['--build',build,'--target','JavaScriptCoreJIT','-j','4'],{cwd:sourceRoot,env:buildEnv,stdio:'inherit',timeout:6*60*60*1000});
        command('perl',builder,{cwd:sourceRoot,env:buildEnv,stdio:'inherit',timeout:6*60*60*1000});
      }
      build=join(sourceRoot,'WebKitBuild','JSCOnly','Release');
      jsc=join(build,'bin','jsc');
      env.LD_LIBRARY_PATH=[join(build,'lib'),env.LD_LIBRARY_PATH].filter(Boolean).join(':');
      env.DYLD_FRAMEWORK_PATH=[build,env.DYLD_FRAMEWORK_PATH].filter(Boolean).join(':');
    }
    if(!await exists(jsc))throw Error('WebKit release build did not produce its JSC shell: '+jsc);
    command(jsc,['-e','if(typeof WebAssembly!=="object"||!WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0])))throw Error("WebAssembly smoke check failed")']);
    const binarySha256=digest(await readFile(jsc));
    env.WASMBENCH_JSC=jsc;env.WASMBENCH_JSC_VERSION='WebKitGTK/'+version;
    invoke('build','--runtimes',configuration);
    source={...upstream,buildDirectory:build,builder,jsc,binarySha256};
  } else if(pin.engine==='spidermonkey') {
    if(!/^\d+\.\d+$/.test(version))throw Error('Unqualified SpiderMonkey release: '+pin.tag);
    const assetName=process.platform==='darwin'&&process.arch==='arm64'?'jsshell-mac.zip':process.platform==='linux'&&process.arch==='x64'?'jsshell-linux-x86_64.zip':null;
    if(!assetName)throw Error('No qualified SpiderMonkey release shell for '+process.platform+'/'+process.arch);
    const base=`https://archive.mozilla.org/pub/firefox/releases/${version}/`,relative=`jsshell/${assetName}`;
    const manifest=join(root,'toolchains',`firefox-${version}-SHA256SUMS`),archive=join(root,'toolchains',assetName),target=join(root,'toolchains',`spidermonkey-${version}`);
    await mkdir(join(root,'toolchains'),{recursive:true});
    command('curl',['--fail','--location','--retry','3','--max-time','120',base+'SHA256SUMS','-o',manifest],{timeout:3*60*1000});
    const line=(await readFile(manifest,'utf8')).split(/\r?\n/).find(item=>item.trim().endsWith('  '+relative));
    if(!line)throw Error('Official Mozilla SHA256SUMS has no entry for '+relative);
    const archiveSha256=line.trim().split(/\s+/)[0];
    command('curl',['--fail','--location','--retry','3','--max-time','600',base+relative,'-o',archive],{timeout:10*60*1000});
    if(digest(await readFile(archive))!==archiveSha256)throw Error('Official SpiderMonkey shell archive checksum mismatch');
    await mkdir(target,{recursive:true});command('unzip',['-oq',archive,'-d',target],{timeout:3*60*1000});
    const js=join(target,'js');if(!await exists(js))throw Error('SpiderMonkey release shell archive did not contain js');
    command('chmod',['+x',js]);
    env.WASMBENCH_SPIDERMONKEY=js;env.NODE_OPTIONS='';
    source={archiveUrl:base+relative,archiveSha256,checksumManifest:base+'SHA256SUMS',binarySha256:digest(await readFile(js)),binary:js};
  } else if(pin.engine==='wavm') {
    if(!/^nightly\/\d{4}-\d{2}-\d{2}$/.test(pin.tag))throw Error('Unqualified WAVM nightly tag: '+pin.tag);
    const releases=githubReleases(pin.repository),release=releases.find(item=>item.tag_name===pin.tag);
    if(!release||release.published_at!==pin.publishedAt)throw Error('WAVM nightly release metadata changed since planning');
    const platform=process.platform==='darwin'&&process.arch==='arm64'?'macos-arm64':process.platform==='linux'&&process.arch==='x64'?'linux-x64':null;
    if(!platform)throw Error('No qualified WAVM nightly archive for '+process.platform+'/'+process.arch);
    const preferred=`wavm-${pin.tag.replace('/','-')}-${platform}.tar.gz`;
    const legacy=process.platform==='darwin'?'wavm-0.0.0-prerelease-macos.tar.gz':'wavm-0.0.0-prerelease-linux.tar.gz';
    const asset=release.assets?.find(item=>item.name===preferred)||release.assets?.find(item=>item.name===legacy),assetName=asset?.name;
    const expected=asset?.digest?.replace(/^sha256:/,'');
    if(!asset?.browser_download_url||expected&&!/^[a-f0-9]{64}$/.test(expected))throw Error('WAVM nightly has no usable release archive receipt: '+(assetName||preferred));
    const archive=join(root,'toolchains',assetName),sdk=join(root,'toolchains',`wavm-${pin.tag.slice('nightly/'.length)}-${digest(Buffer.from(pin.tag+assetName)).slice(0,12)}`,'sdk');
    await mkdir(dirname(sdk),{recursive:true});await mkdir(join(root,'toolchains'),{recursive:true});
    command('curl',['--fail','--location','--retry','3','--max-time','600',asset.browser_download_url,'-o',archive],{timeout:10*60*1000});
    const archiveBytes=await readFile(archive),archiveSha256=digest(archiveBytes);
    if(expected&&archiveSha256!==expected)throw Error('Official WAVM nightly archive checksum mismatch');
    if(Number.isSafeInteger(asset.size)&&archiveBytes.length!==asset.size)throw Error('WAVM release asset size differs from the official GitHub release metadata');
    await mkdir(sdk,{recursive:true});command('tar',['-xzf',archive,'-C',sdk],{timeout:10*60*1000});
    const api=join(sdk,'include/WAVM/wavm-c/wavm-c.h'),libraryDir=join(sdk,'lib');
    const libraries=(await readdir(libraryDir)).filter(name=>/^libWAVM\.(?:dylib|so(?:\.[\d.]+)?|a)$/.test(name));
    if(!await exists(api)||!libraries.length)throw Error('WAVM nightly archive lacks the C API or runtime library');
    const binary=join(sdk,'bin','wavm'),binarySha256=digest(await readFile(binary)),binaryFormat=command('file',[binary]).toString().trim();
    const native=process.platform==='darwin'?/Mach-O 64-bit executable arm64/.test(binaryFormat):/ELF 64-bit.*x86-64/.test(binaryFormat);
    if(!native){const error=Error(`WAVM nightly asset is not native to ${process.platform}/${process.arch}: ${binaryFormat}`);error.code='BINDING_UNAVAILABLE';throw error;}
    const versionText=command(binary,['version']).toString();if(!versionText.includes('WAVM version '))throw Error('WAVM nightly binary does not identify itself as WAVM');
    const tagCache=join(releaseCache(),pin.repository.replace('/','-'),pin.tag.replaceAll('/','-'));
    await mkdir(dirname(tagCache),{recursive:true});
    if(!await exists(join(tagCache,'.git'))){command('git',['init',tagCache]);command('git',['-C',tagCache,'remote','add','origin',`https://github.com/${pin.repository}.git`]);}
    command('git',['-C',tagCache,'fetch','--depth','1','--filter=blob:none','origin',`refs/tags/${pin.tag}`],{stdio:'inherit'});
    const revision=command('git',['-C',tagCache,'rev-parse','FETCH_HEAD^{commit}']).toString().trim();
    command('git',['-C',tagCache,'checkout','--detach',revision]);
    const adapterVersion=`nightly-${pin.tag.slice('nightly/'.length)}-${revision.slice(0,7)}`;
    env.WASMBENCH_WAVM_SDK=sdk;env.WASMBENCH_WAVM_VERSION=adapterVersion;
    invoke('build','--runtimes',configuration);
    source={tag:pin.tag,revision,adapterVersion,assetId:asset.id,assetName,assetUrl:asset.browser_download_url,
      upstreamSha256:expected||null,archiveSha256,checksumSource:expected?'GitHub release digest':'locally computed SHA-256; GitHub release metadata had no digest',
      assetSize:asset.size,binaryFormat,binarySha256,runtimeLibrary:await Promise.all(libraries.map(async name=>({name,sha256:digest(await readFile(join(libraryDir,name)))}))),sdk};
  } else if(pin.engine==='wasmer') {
    source=await releaseSource(pin.repository,{tag:pin.tag});
    if(source.publishedAt!==pin.publishedAt)throw Error('Wasmer publication metadata changed since planning');
    assertReleasedSource(source.source,source);
    command('git',['submodule','update','--init','--depth','1','lib/napi'],{cwd:source.source,stdio:'inherit'});
    const napi=command('git',['rev-parse','HEAD:lib/napi'],{cwd:source.source}).toString().trim();
    if(command('git',['-C','lib/napi','rev-parse','HEAD'],{cwd:source.source}).toString().trim()!==napi)throw Error('Wasmer NAPI submodule differs from its published gitlink');
    const sdk=join(root,'toolchains',`wasmer-${version}`,'sdk'),target=join(root,'toolchains',`wasmer-${version}`,'target');
    const features='sys-default,cranelift,singlepass,wasi,wasmer-artifact-create,wasmer-artifact-load';
    command('cargo',['build','--manifest-path',join(source.source,'lib/c-api/Cargo.toml'),'--release','--locked','--no-default-features','--features',features],{cwd:source.source,env:{...env,CARGO_TARGET_DIR:target},stdio:'inherit',timeout:90*60*1000});
    const libraryName=process.platform==='darwin'?'libwasmer.dylib':process.platform==='linux'?'libwasmer.so':null;
    if(!libraryName)throw Error('Unsupported Wasmer historical build platform');
    await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
    for(const [from,to] of [['lib/c-api/wasmer.h','wasmer.h'],['lib/c-api/tests/wasm-c-api/include/wasm.h','wasm.h']])await cp(join(source.source,from),join(sdk,'include',to));
    const library=join(target,'release',libraryName);await cp(library,join(sdk,'lib',libraryName));
    env.WASMBENCH_WASMER_SDK=sdk;
    invoke('build','--runtimes',configuration);
    assertReleasedSource(source.source,source);
    if(command('git',['-C','lib/napi','rev-parse','HEAD'],{cwd:source.source}).toString().trim()!==napi)throw Error('Wasmer NAPI submodule changed during the build');
    source={...source,sdk,features,napi,librarySha256:digest(await readFile(join(sdk,'lib',libraryName))),lockSha256:digest(await readFile(join(source.source,'Cargo.lock')))};
  } else {
    const error=Error('A release-specific performance build binding is still required for '+pin.engine+' '+pin.tag);
    error.code='BINDING_PENDING';throw error;
  }
  return {engine:pin.engine,version,release:pin,source,configuration,created:new Date().toISOString()};
}

export function assertHistoricalRuntime(runtime,binding) {
  if(runtime.id!==binding.configuration)throw Error('Historical configuration does not match its release binding');
  const actual=runtime.description?.runtime_version;
  if(binding.engine==='v8') {
    if(actual!==binding.source.embeddedV8||runtime.description?.build!=='v'+binding.source.nodeVersion||!runtime.description?.backend?.startsWith('production-default-tiering'))throw Error('Historical V8 does not match its release-pinned Node/V8 binary or production-default tier policy');
  } else if(binding.engine==='deno') {
    if(actual!==binding.source.v8Version||runtime.description?.build!=='Deno '+binding.version||runtime.description?.effective_configuration?.compiler_mode!=='optimizing-only')throw Error('Historical Deno release, embedded V8, or optimizing-only tier policy differs');
  } else if(binding.engine==='jsc') {
    const binary='binary-sha256:'+binding.source.binarySha256;
    if(actual!=='WebKitGTK/'+binding.version||runtime.description?.build!==binary||!runtime.description?.backend?.includes('OMG'))throw Error('Historical JavaScriptCore release binary identity or forced OMG tier differs');
  } else if(binding.engine==='wago') {
    if(!actual?.startsWith(binding.source.revision+'/source-'))throw Error('Historical Wago source differs from its release');
  } else if(binding.engine==='wasmer') {
    if(actual!==binding.version||runtime.description?.backend!=='singlepass-jit')throw Error('Historical Wasmer release or Singlepass backend differs');
  } else if(binding.engine==='wavm') {
    if(actual!==binding.source.adapterVersion)throw Error('Historical WAVM nightly release differs');
  } else if(binding.engine==='spidermonkey') {
    if(runtime.description?.build!=='binary-sha256:'+binding.source.binarySha256||runtime.description?.effective_configuration?.wasm_compiler!=='Ion only'||runtime.description?.effective_configuration?.flags!=='--wasm-compiler=ion')throw Error('Historical SpiderMonkey shell or forced Ion tier differs');
  } else if(actual!==binding.version)throw Error('Historical engine version differs from its release: '+actual+' != '+binding.version);
  if(binding.engine==='wazero' && !runtime.description?.effective_configuration?.compile_policy?.startsWith('fresh uncached module per operation;'))throw Error('Historical wazero has no fresh compile policy');
}
