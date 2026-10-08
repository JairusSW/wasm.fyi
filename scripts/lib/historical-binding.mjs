import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {command,digest,exists} from './wasmbench.mjs';
import {releaseSource,assertReleasedSource,releaseCache,githubRelease} from './release-policy.mjs';
import {configureWasmerLLVM} from './llvm-toolchain.mjs';
import {buildWamrSDK} from './wamr-sdk.mjs';
import {buildWasmEdgeSDK} from './wasmedge-sdk.mjs';
import {buildChicorySDK} from './chicory-sdk.mjs';
import {buildCTranspilerSDK} from './c-transpiler-sdk.mjs';
import {buildWavmSDK} from './wavm-sdk.mjs';
import {buildJavaScriptCoreSDK} from './jsc-sdk.mjs';
import {runCommand} from './benchmark-process.mjs';

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
    if(path.startsWith('toolchains/') || path.split('/').some(part=>part==='__pycache__'))continue;
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

export async function restoreHistoricalHarnessSources(base,root) {
 const files=command('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:base}).toString().split('\0').filter(Boolean);
 for(const path of files) {
  if(path.startsWith('toolchains/')||path.split('/').includes('__pycache__'))continue;
  if(path.startsWith('/')||path.split('/').includes('..'))throw Error('Unsafe harness input');
  await mkdir(dirname(join(root,path)),{recursive:true});await cp(join(base,path),join(root,path),{dereference:true});
 }
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
  const runSDK=(program,args,options={})=>runCommand(program,args,{cwd:root,env,log:join(root,'sdk-build.log'),signal:AbortSignal.timeout(90*60*1000),...options});
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
    env.WASMBENCH_NODE=node;env.NODE_OPTIONS='';env.WASMBENCH_V8_COMPILER_MODE='optimizing-only';
    source={nodeVersion,embeddedV8,plannedEmbeddedV8:pin.embeddedV8||null,archiveName,archiveSha256,nodeSha256:digest(await readFile(node)),checksumManifest:'https://nodejs.org/dist/'+pin.tag+'/SHASUMS256.txt'};
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
    if(major===24||major===36) {
      await replace('adapters/wasmtime/Cargo.toml','features = ["p1"]','features = ["preview1"]');
      if(major===24){
        await replace('adapters/wasmtime/Cargo.toml','wasmtime-internal-jit-icache-coherence = { version','wasmtime-internal-jit-icache-coherence = { package = "wasmtime-jit-icache-coherence", version');
        await replace('adapters/wasmtime/Cargo.toml','component-async-probes = ["wasmtime/component-model-async"]','component-async-probes = []');
        await replace('adapters/wasmtime/src/pooling.rs','.memory_reservation(16 * 1024 * 1024)','.static_memory_maximum_size(16 * 1024 * 1024)');
        await replace('adapters/wasmtime/src/pooling.rs','.memory_guard_size(65536)','.static_memory_guard_size(65536).dynamic_memory_guard_size(65536)');
        await replace('adapters/wasmtime/src/vectors.rs','Val::default_for_ty(&t)', 'match t { ValType::I32=>Some(Val::I32(0)), ValType::I64=>Some(Val::I64(0)), ValType::F32=>Some(Val::F32(0)), ValType::F64=>Some(Val::F64(0)), ValType::V128=>Some(Val::V128(0u128.into())), ValType::Ref(r) if r.is_nullable()=>Some(Val::null_ref(r.heap_type())), _=>None }');
      }
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
        'pub fn configure(config:&mut Config,winch:bool){config.wasm_tail_call(!winch);config.wasm_relaxed_simd(!winch);'+(major===24?'':'config.wasm_exceptions(false);config.wasm_legacy_exceptions(false);')+'if winch&&cfg!(target_arch="aarch64"){config.wasm_simd(false);}}\n'+
        'pub fn describe(winch:bool)->Value{json!({"namespace":"Wasmtime '+major+' Config defaults","enabled":{"TAIL_CALL":!winch,"RELAXED_SIMD":!winch,"SIMD":!(winch&&cfg!(target_arch="aarch64"))},"disabled":["GC","FUNCTION_REFERENCES","THREADS","STACK_SWITCHING","CM_ASYNC","CM_ASYNC_STACKFUL"]})}\n');
      await writeFile(join(root,'adapters/wasmtime/src/component_calls.rs'),
        'use serde_json::{Value,json};\nuse wasmtime::{Engine,Result};\n'+
        'pub const POLICY:&str="component-u64-v1";pub const BOUNDARIES:&str="not measured: features held";\n'+
        'pub fn validate(_: &Value)->Result<()>{Ok(())}\n'+
        'pub fn run(_: &Engine,_:&[u8],_:&Value,_:&Value,_:&mut dyn FnMut(u64,&str)->Result<()>)->Result<Value>{Ok(json!({"status":"unsupported","reason":"historical Component Model features held"}))}\n');
      await writeFile(join(root,'adapters/wasmtime/src/components.rs'),
        'use serde_json::{Value,json};\nuse wasmtime::{Engine,Result};\n'+
        'pub fn validate_workload(_: &Value)->Result<()>{Ok(())}\n'+
        'pub fn run(_: &Engine,_:&[u8],_:&Value,_:&Value)->Result<Value>{Ok(json!({"status":"unsupported","reason":"historical Component Model features held"}))}\n');
      compatibilityPatch={adapterApi:'Wasmtime '+major,wasiPreview1Feature:'preview1',components:'excluded from this feature-held suite',filesSha256:digest(JSON.stringify(await Promise.all(files.map(async path=>[path,digest(await readFile(join(root,path)))]))))};
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
    const sdk=join(root,'toolchains',`${configuration}-${version}`);await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
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
      const target=join(root,'toolchains',`wamr-build-${configuration}-${version}`);
      const isolated=join(root,'toolchains',`wamr-source-${configuration}-${version}`);
      if(!await exists(isolated))command('git',['-C',source.source,'worktree','add','--detach',isolated,source.revision],{stdio:'inherit'});
      let compiled;
      try {compiled=await buildWamrSDK({source:isolated,sdk,target,configuration,version,env,run:runSDK});}
      catch(error){if(error.code==='UNSUPPORTED_PLATFORM')error.proof={...error.proof,revision:source.revision};throw error;}
      assertReleasedSource(source.source,source);
      source={...source,buildFlags:compiled.flags,libraries:compiled.libraries,measurementPatch:compiled.measurementPatch,measurementSource:isolated};
    }
    invoke('build','--runtimes',configuration);
    source={...source,version,sdk,buildFlags:pin.engine==='wamr'?source.buildFlags:['Release','WASI disabled']};
  } else if(['wasm2c','w2c2'].includes(pin.engine)) {
    source=await releaseSource(pin.repository,{tag:pin.tag});assertReleasedSource(source.source,source);
    if(source.publishedAt!==pin.publishedAt)throw Error('C transpiler publication metadata changed since planning');
    const compiled=await buildCTranspilerSDK({source:source.source,sdk:join(root,'toolchains',`${pin.engine}-${version}`),target:join(root,'toolchains',`${pin.engine}-build-${version}`),engine:pin.engine,env,run:runSDK});
    assertReleasedSource(source.source,source);invoke('build','--runtimes',configuration);source={...source,sdk:compiled};
  } else if(pin.engine==='chicory') {
    source=await releaseSource(pin.repository,{tag:pin.tag});assertReleasedSource(source.source,source);
    if(source.publishedAt!==pin.publishedAt)throw Error('Chicory publication metadata changed since planning');
    const compiled=await buildChicorySDK({source:source.source,root,version,env,run:runSDK});
    assertReleasedSource(source.source,source);invoke('build','--runtimes',configuration);
    source={...source,sdk:compiled};
  } else if(pin.engine==='wasmedge') {
    source=await releaseSource(pin.repository,{tag:pin.tag});assertReleasedSource(source.source,source);
    if(source.publishedAt!==pin.publishedAt)throw Error('WasmEdge publication metadata changed since planning');
    const isolated=join(root,'toolchains',`wasmedge-source-${configuration}-${version}`);
    if(!await exists(isolated))command('git',['-C',source.source,'worktree','add','--detach',isolated,source.revision],{stdio:'inherit'});
    const sdk=join(root,'toolchains',`wasmedge-${configuration}-${version}`),target=join(root,'toolchains',`wasmedge-build-${configuration}-${version}`);
    let compiled;
    try {compiled=await buildWasmEdgeSDK({source:isolated,sdk,target,configuration,env,run:runSDK});}
    catch(error){if(error.code==='UNSUPPORTED_BACKEND')error.proof={...error.proof,revision:source.revision};throw error;}
    assertReleasedSource(source.source,source);
    invoke('build','--runtimes',configuration);
    source={...source,sdk,measurementSource:isolated,buildFlags:compiled.flags,libraries:compiled.libraries,measurementPatch:compiled.measurementPatch};
  } else if(pin.engine==='jsc') {
    const upstream=await webkitReleaseSource(pin.tag);
    const sdk=await buildJavaScriptCoreSDK({source:upstream.source,target:join(root,'toolchains','jsc-'+version),revision:'WebKitGTK/'+version,env,run:runSDK});
    assertReleasedSource(upstream.source,upstream);
    source={...upstream,...sdk,jsc:sdk.binary};
  } else if(pin.engine==='spidermonkey') {
    if(!/^\d+\.\d+(?:\.\d+)?(?:b\d+|esr)?$/.test(version))throw Error('Unqualified SpiderMonkey release: '+pin.tag);
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
    const release=githubRelease(pin.repository,pin.tag);
    if(!release||release.published_at!==pin.publishedAt)throw Error('WAVM nightly release metadata changed since planning');
    const tagCache=join(releaseCache(),pin.repository.replace('/','-'),pin.tag.replaceAll('/','-'));
    await mkdir(tagCache,{recursive:true});
    if(!await exists(join(tagCache,'.git'))){command('git',['init',tagCache]);command('git',['-C',tagCache,'remote','add','origin',`https://github.com/${pin.repository}.git`]);}
    if(command('git',['-C',tagCache,'status','--porcelain','--untracked-files=no']).length)throw Error('WAVM nightly source contains tracked changes');
    command('git',['-C',tagCache,'fetch','--depth','1','--filter=blob:none','origin',`refs/tags/${pin.tag}`],{stdio:'inherit'});
    const revision=command('git',['-C',tagCache,'rev-parse','FETCH_HEAD^{commit}']).toString().trim();
    const tagReceipt=join(tagCache,'.git/wasm-fyi-nightly.json');
    if(await exists(tagReceipt)&&JSON.parse(await readFile(tagReceipt)).revision!==revision)throw Error('Published WAVM nightly tag moved');
    command('git',['-C',tagCache,'checkout','--detach',revision]);
    await writeFile(tagReceipt,JSON.stringify({tag:pin.tag,revision,publishedAt:pin.publishedAt})+'\n');
    const adapterVersion=`nightly-${pin.tag.slice('nightly/'.length)}-${revision.slice(0,7)}`;
    const sdk=join(root,'toolchains',`wavm-${pin.tag.slice('nightly/'.length)}`,'sdk'),target=join(root,'toolchains',`wavm-build-${pin.tag.slice('nightly/'.length)}`);
    const compiled=await buildWavmSDK({source:tagCache,sdk,target,env,run:runSDK});
    env.WASMBENCH_WAVM_VERSION=adapterVersion;invoke('build','--runtimes',configuration);
    assertReleasedSource(tagCache,{revision});
    source={tag:pin.tag,revision,adapterVersion,publishedAt:pin.publishedAt,sdk,build:compiled,policy:'Native SDK built from the exact published nightly tag; no substituted archive or runtime'};
  } else if(pin.engine==='wasmer') {
    source=await releaseSource(pin.repository,{tag:pin.tag});
    if(source.publishedAt!==pin.publishedAt)throw Error('Wasmer publication metadata changed since planning');
    assertReleasedSource(source.source,source);
    command('git',['submodule','update','--init','--depth','1','lib/napi'],{cwd:source.source,stdio:'inherit'});
    const napi=command('git',['rev-parse','HEAD:lib/napi'],{cwd:source.source}).toString().trim();
    if(command('git',['-C','lib/napi','rev-parse','HEAD'],{cwd:source.source}).toString().trim()!==napi)throw Error('Wasmer NAPI submodule differs from its published gitlink');
    const sdk=join(root,'toolchains',`wasmer-${version}`,'sdk'),target=join(root,'toolchains',`wasmer-${version}`,'target');
    let llvmToolchain=null;
    if(configuration==='wasmer-llvm')llvmToolchain=await configureWasmerLLVM(source.source,env,async(program,args)=>({output:command(program,args,{cwd:root,env}).toString()}));
    const features='sys-default,cranelift,singlepass,wasi,wasmer-artifact-create,wasmer-artifact-load'+(configuration==='wasmer-llvm'?',llvm':'');
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
    source={...source,sdk,features,napi,llvmToolchain,librarySha256:digest(await readFile(join(sdk,'lib',libraryName))),lockSha256:digest(await readFile(join(source.source,'Cargo.lock')))};
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
    if(actual!==binding.source.embeddedV8||runtime.description?.build!=='v'+binding.source.nodeVersion||runtime.description?.backend!=='optimizing-only')throw Error('Historical V8 does not match its release-pinned Node/V8 binary or eager optimizing compiler policy');
  } else if(binding.engine==='jsc') {
    const binary='binary-sha256:'+binding.source.binarySha256;
    if(actual!=='WebKitGTK/'+binding.version||runtime.description?.build!==binary||!runtime.description?.backend?.includes('OMG'))throw Error('Historical JavaScriptCore release binary identity or forced OMG tier differs');
  } else if(binding.engine==='wago') {
    if(!actual?.startsWith(binding.source.revision+'/source-'))throw Error('Historical Wago source differs from its release');
  } else if(['wasm2c','w2c2'].includes(binding.engine)) {
    if(actual!==binding.configuration+':'+binding.source.sdk.translatorSha256||runtime.description?.backend!=='c-aot'||runtime.description?.effective_configuration?.translator_sha256!==binding.source.sdk.translatorSha256)throw Error('Historical C transpiler binary or backend differs');
  } else if(binding.engine==='wasmer') {
    if(actual!==binding.version||runtime.description?.backend!==(binding.configuration==='wasmer-llvm'?'llvm-jit':'singlepass-jit'))throw Error('Historical Wasmer release or selected compiler backend differs');
  } else if(binding.engine==='wavm') {
    if(actual!==binding.source.adapterVersion)throw Error('Historical WAVM nightly release differs');
  } else if(binding.engine==='spidermonkey') {
    if(runtime.description?.build!=='binary-sha256:'+binding.source.binarySha256||runtime.description?.effective_configuration?.wasm_compiler!=='Ion only'||runtime.description?.effective_configuration?.flags!=='--wasm-compiler=ion')throw Error('Historical SpiderMonkey shell or forced Ion tier differs');
  } else if(actual!==binding.version)throw Error('Historical engine version differs from its release: '+actual+' != '+binding.version);
  if(binding.engine==='wazero' && !runtime.description?.effective_configuration?.compile_policy?.startsWith('fresh uncached module per operation;'))throw Error('Historical wazero has no fresh compile policy');
}
