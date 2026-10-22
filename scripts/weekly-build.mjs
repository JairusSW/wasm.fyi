import {applyWazeroSampling,restoreHistoricalWazeroSources} from './lib/wazero-sampling.mjs';
import {applyWazeroFeaturePolicy} from './lib/wazero-feature-policy.mjs';
import {applyW2c2Bridge} from './lib/w2c2-bridge.mjs';
import {configureNodeCompilerCache,summarizeCompilerCacheStats} from './lib/node-compiler-cache.mjs';
import {selectV8TurboshaftPolicy} from './lib/v8-turboshaft.mjs';
import {selectV8CacheDisableFlag} from './lib/v8-cache-flag.mjs';
import {applyWasm3Sampling} from './lib/wasm3-sampling.mjs';
import {applyWasm3FeaturePolicy,wasm3FeatureCMakeFlags} from './lib/wasm3-feature-policy.mjs';
import {verifySDKSubmodules} from './lib/sdk-submodules.mjs';
import {nodeBuildPython,nodeBuildEnvironment} from './lib/node-build-python.mjs';
import {ensureNodeFmtStandardLibrary} from './lib/node-fmt-stdlib.mjs';
import {buildWizardSDK} from './lib/wizard-sdk.mjs';
import {buildGraalWasmSDK} from './lib/graalwasm-sdk.mjs';
import {applyWasmerCraneliftAdapter} from './lib/wasmer-cranelift-adapter.mjs';
import {wasmerBuildEnvironment} from './lib/wasmer-build-environment.mjs';
import {applyWagoColdCompile} from './lib/wago-cold-compile.mjs';
import {applyWagoThreads} from './lib/wago-threads.mjs';
import {buildZwasmSDK} from './lib/zwasm-sdk.mjs';
import {adaptWazyComponents,adaptWazyCoreFeatures} from './lib/wazy-adapter.mjs';
import {applyLegacyWasmtimeAPI} from './lib/wasmtime-legacy-api.mjs';
// Build the Saturday default-branch snapshots in an isolated native harness.
import {readFile, writeFile, mkdir, cp, stat, readdir} from 'node:fs/promises';
import {join, resolve, basename} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {availableParallelism} from 'node:os';
import {copyHistoricalHarness} from './lib/historical-binding.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {digest} from './lib/wasmbench.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {adaptLegacyWago} from './lib/wago-legacy.mjs';
import {adaptCoreLegacyWago} from './lib/wago-core-legacy.mjs';
import {sourceContains} from './lib/source-compatibility.mjs';
import {configureWasmerLLVM} from './lib/llvm-toolchain.mjs';
import {buildWamrSDK} from './lib/wamr-sdk.mjs';
import {buildWasmEdgeSDK} from './lib/wasmedge-sdk.mjs';
import {applyWasmEdgeWorkloadCoverage} from './lib/wasmedge-workload-coverage.mjs';
import {applyWasmEdgeFeaturePolicy} from './lib/wasmedge-feature-policy.mjs';
import {buildWavmSDK} from './lib/wavm-sdk.mjs';
import {applyWavmFeaturePolicy} from './lib/wavm-feature-policy.mjs';
import {buildChicorySDK} from './lib/chicory-sdk.mjs';
import {buildCTranspilerSDK} from './lib/c-transpiler-sdk.mjs';
import {buildSpiderMonkeySDK} from './lib/spidermonkey-sdk.mjs';
import {buildJavaScriptCoreSDK} from './lib/jsc-sdk.mjs';
import {buildEndiveSDK} from './lib/endive-sdk.mjs';
import {buildChasmSDK} from './lib/chasm-sdk.mjs';
import {startupLaunchCommand} from './lib/sdk-startup.mjs';
import {requireBuildCapacity,withBuildReserve} from './lib/build-capacity.mjs';
import {createSDKBuildBudget} from './lib/sdk-build-budget.mjs';
import {applyWasmiProposals} from './lib/wasmi-proposals.mjs';
import {wasmerNativeSizeGetter} from './lib/wasmer-native-size.mjs';
const [directoryArg, engine, baseArg] = process.argv.slice(2);
const directory=resolve(directoryArg), base=resolve(baseArg), root=join(directory,'harness',engine);
const pin=JSON.parse(await readFile(join(directory,'pins.json'))).pins.find(p=>p.engine===engine);
if(!pin || pin.status!=='planned')throw Error('Missing exact source pin');
const source=join(directory,'sources',engine), receiptPath=join(directory,engine+'-build.json');
const env={...process.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',...(process.env.WASMFYI_BUILD_JOBS?{CARGO_BUILD_JOBS:process.env.WASMFYI_BUILD_JOBS}:{}),WASMBENCH_V8_COMPILER_MODE:'optimizing-only',NODE_OPTIONS:''};
const log=join(directory,engine+'-build.log');
await requireBuildCapacity(directory,engine,env);
const sdkBudget=createSDKBuildBudget(env);
const run=async(program,args,options={})=>{console.log(engine,program,args.join(' '));return withBuildReserve(directory,engine,env,signal=>sdkBudget.run(combined=>runCommand(program,args,{cwd:root,env,log,...options,signal:combined}),signal&&options.signal?AbortSignal.any([signal,options.signal]):signal||options.signal));};
if(!(await stat(root).catch(()=>null)))await copyHistoricalHarness(base,root);
if(['jsc','spidermonkey','chicory'].includes(engine)) {
 for(const path of ['adapters/js-shell/adapter.js','adapters/js-shell/jsc-host.cpp','experiment/extra_runtimes.go','experiment/extra_runtimes_test.go','experiment/runner.go'])await cp(join(base,path),join(root,path));
}
if(engine==='wamr'){
 const path=join(root,'experiment/extra_runtimes.go');let text=await readFile(path,'utf8');
 const base='"wasmi", "wavm", "wamr", "wasm3"',aliases='"wasmi", "wavm", "wamr", "wamr-fast-jit", "wamr-llvm-jit", "wasm3"';
 const occurrences=text.split(base).length-1,adapted=text.split(aliases).length-1;
 if(occurrences===3)text=text.replaceAll(base,aliases).replace('strings.ReplaceAll(id, "-", "_")','func() string { if strings.HasPrefix(id, "wamr-") { return "wamr" }; return strings.ReplaceAll(id, "-", "_") }()');
 else if(adapted!==3)throw Error('WAMR runtime alias anchors changed');
 await writeFile(path,text);
 const embeddingPath=join(root,'adapters/native/src/wamr.cpp');let embedding=await readFile(embeddingPath,'utf8');
 const oldEngine='struct Engine { wasm_engine_t* value=wasm_engine_new(); Engine(){wasm_runtime_set_log_level(WASM_LOG_LEVEL_FATAL);if(!wasm_runtime_register_natives("wasmbench",host_symbols,1))throw std::runtime_error("identity host function registration failed");} ~Engine(){if(value)wasm_engine_delete(value);} };';
 const newEngine=`// wasm.fyi: bind the requested WAMR execution backend before engine creation.
struct Engine { wasm_engine_t* value=nullptr; Engine(){value=wasm_engine_new();if(!value)throw std::runtime_error("engine creation failed");wasm_runtime_set_log_level(getenv("WASMBENCH_WAMR_DIAGNOSTICS")?WASM_LOG_LEVEL_VERBOSE:WASM_LOG_LEVEL_FATAL);const char* selected=getenv("WASMBENCH_WAMR_RUNNING_MODE");RunningMode mode=Mode_Interp;if(selected&&strcmp(selected,"llvm-jit")==0)mode=Mode_LLVM_JIT;else if(selected&&strcmp(selected,"fast-jit")==0)mode=Mode_Fast_JIT;if(!wasm_runtime_is_running_mode_supported(mode)||!wasm_runtime_set_default_running_mode(mode))throw std::runtime_error("requested WAMR running mode is unavailable");if(!wasm_runtime_register_natives("wasmbench",host_symbols,1))throw std::runtime_error("identity host function registration failed");} ~Engine(){if(value)wasm_engine_delete(value);} };`;
 embedding=embedding.replace(String.raw`creation.\nstruct`,`creation.
struct`);
 if(embedding.includes(oldEngine))embedding=embedding.replace(oldEngine,newEngine);
 else if(embedding.includes('// wasm.fyi: bind the requested WAMR execution backend'))embedding=embedding.replace(/\/\/ wasm\.fyi: bind the requested WAMR execution backend before engine creation\.\nstruct Engine \{[^\n]+ \};/,newEngine);
 else throw Error('WAMR running-mode adapter anchor changed');
 const moduleAnchor='void* wb_module_new(void* e,const uint8_t* bytes,size_t n){WB_TRY{\n';
 const diagnostic='    if(getenv("WASMBENCH_WAMR_DIAGNOSTICS")){char error[512]={};auto probe=wasm_runtime_load(const_cast<uint8_t*>(bytes),static_cast<uint32_t>(n),error,sizeof(error));if(!probe)throw std::runtime_error(std::string("raw WAMR loader: ")+error);wasm_runtime_unload(probe);}\n';
 if(!embedding.includes('raw WAMR loader:')){if(!embedding.includes(moduleAnchor))throw Error('WAMR module diagnostic anchor changed');embedding=embedding.replace(moduleAnchor,moduleAnchor+diagnostic)}
 await writeFile(embeddingPath,embedding);
 const mainPath=join(root,'adapters/native/src/main.rs');let main=await readFile(mainPath,'utf8');
 const backend='if cfg!(feature="wavm") || cfg!(feature="wasmer_llvm"){"llvm-jit"}else if cfg!(feature="wasmer_singlepass"){"singlepass-jit"}else{"interpreter"}';
 const wamrBackend='if cfg!(feature="wamr"){match option_env!("WASMBENCH_WAMR_RUNNING_MODE"){Some("llvm-jit")=>"llvm-jit",Some("fast-jit")=>"fast-jit",_=>"interpreter"}}else '+backend;
 if(main.includes(backend))main=main.replace(backend,wamrBackend);else if(!main.includes('option_env!("WASMBENCH_WAMR_RUNNING_MODE")'))throw Error('WAMR backend description anchor changed');
 await writeFile(mainPath,main);
}
if(engine==='wasmedge'){
 const path=join(root,'experiment/extra_runtimes.go');let text=await readFile(path,'utf8');
 const base='"wasmi", "wavm", "wamr", "wasm3", "wasmedge", "wasmer-llvm", "wasmer-singlepass"';
 const aliases='"wasmi", "wavm", "wamr", "wasm3", "wasmedge", "wasmedge-jit", "wasmer-llvm", "wasmer-singlepass"';
 const occurrences=text.split(base).length-1,adapted=text.split(aliases).length-1;
 if(occurrences===3)text=text.replaceAll(base,aliases);
 else if(adapted!==3)throw Error('WasmEdge runtime alias anchors changed');
 await writeFile(path,text);
}
const harnessRevision=(await run('git',['-C',base,'rev-parse','HEAD'])).output.trim();
if((await run('git',['-C',base,'status','--porcelain','--untracked-files=no'])).output.trim())throw Error('Frozen harness has tracked changes');
if(!(await stat(join(root,'.git')).catch(()=>null)))await run('git',['init',root]);
await run('git',['-C',root,'add','--','.',...(engine==='zwasm'?[':(exclude)zwasm-link-objects']:[])]);
await mkdir(join(root,'bin'),{recursive:true});
const controller=join(directory,'controller');
await run(process.execPath,[join(process.cwd(),'scripts/apply-controller-sampling.mjs'),root]);
// Go's build cache reuses unchanged objects; this also refreshes a controller
// left by an interrupted older recipe after registration or collector changes.
await run('go',['build','-trimpath','-o',controller,'./cmd/wasmbench']);
const build=async (...args)=>{
 if(engine==='wago') {
  const wrapper=join(root,'weekly-wago-build.go');
  await writeFile(wrapper,'package main\nimport ("context"; "os"; "github.com/wasmbench/wasmbench/experiment")\nfunc main(){if err:=experiment.BuildWago(context.Background(),os.Args[1],os.Args[2]);err!=nil{panic(err)}}\n');
  return run('go',['run',wrapper,root,args[args.indexOf('--wago-source')+1]]);
 }
 const requested=args.indexOf('--runtimes');
 const configuration=requested>=0?args[requested+1]:pin.configurations[0];
 if(!configuration)throw Error('Native adapter build requires a runtime configuration');
 const aot=['wasm2c','w2c2'].includes(engine),target=join(root,'adapters/native/target',aot?'aot':configuration);
 const feature=aot?'aot':configuration.startsWith('wamr')?'wamr':configuration.startsWith('wasmedge')?'wasmedge':configuration.replaceAll('-','_');
 await run('cargo',['build','--release','--locked','--no-default-features','--features',feature,'--target-dir',target],{cwd:join(root,'adapters/native')});
 await cp(join(target,'release/adapter-native'),join(root,'bin',aot?'adapter-aot':'adapter-'+configuration));
};
let runtimeVersion, provenance={...pin};
if(engine==='wago') {
 const wago=process.env.WEEKLY_WAGO_SOURCE || source;
 const revision=(await run('git',['-C',wago,'rev-parse','HEAD'])).output.trim();
 if(revision!==pin.revision || (await run('git',['-C',wago,'status','--porcelain','--untracked-files=no'])).output.trim())throw Error('Wago source pin differs or is dirty');
 const apiDirs=[wago];if(await stat(join(wago,'src/wago')).catch(()=>null))apiDirs.push(join(wago,'src/wago'));
 const api=(await Promise.all((await Promise.all(apiDirs.map(async dir=>(await readdir(dir)).filter(f=>f.endsWith('.go')&&!f.endsWith('_test.go')).map(f=>join(dir,f))))).flat().map(f=>readFile(f,'utf8')))).join('\n');
 if(!api.includes('func NewImports(')){
  if(!api.includes('type Runtime struct'))provenance.compatibility=await adaptCoreLegacyWago({root,base,run,api});
  else {
  const module=JSON.parse((await run('go',['mod','download','-json','github.com/wago-org/wasi@v0.3.1'])).output);
  if(!module.Dir || !module.Sum)throw Error('WASI compatibility source receipt missing');
  provenance.compatibility=await adaptLegacyWago({root,base,module,run,api});
  }
 }
 provenance.coldCompile=await applyWagoColdCompile(root);
 provenance.threads=await applyWagoThreads(root,api);
 await build('--runtimes','wago','--wago-source',wago);
} else if(engine==='wazero') {
 const download=JSON.parse((await run('go',['mod','download','-json','github.com/tetratelabs/wazero@'+pin.revision])).output);
 if(!download.Version || !download.Sum || download.Origin?.Hash!==pin.revision)throw Error('Wazero module receipt differs from source pin');
 const mod=join(root,'weekly-wazero.mod');await cp(join(root,'go.mod'),mod);await cp(join(root,'go.sum'),mod.replace(/\.mod$/,'.sum'));
 await run('go',['mod','edit','-modfile='+mod,'-require=github.com/tetratelabs/wazero@'+download.Version]);
 await restoreHistoricalWazeroSources(root,base,download.Version.replace(/^v/,''),{includeTests:env.WASMFYI_HISTORY_FAST!=='1'});
 await applyWazeroSampling(root);
	 provenance.featurePolicy=await applyWazeroFeaturePolicy(root);
 await run('go',['build','-mod=mod','-modfile='+mod,'-trimpath','-o',join(root,'bin/adapter-wazero'),'./adapters/wazero']);
 provenance.module=download;runtimeVersion=download.Version;
} else if(engine==='wasmtime') {
 const workspace=await readFile(join(source,'Cargo.toml'),'utf8');
 const minimum=workspace.match(/^rust-version\s*=\s*"(\d+\.\d+(?:\.\d+)?)"/m)?.[1];
 if(minimum){const wanted=minimum.split('.').map(Number);while(wanted.length<3)wanted.push(0);const current=(await run('rustc',['--version'])).output.match(/rustc (\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);if(!current)throw Error('Cannot identify Rust compiler');const older=wanted.some((v,i)=>v>current[i]&&wanted.slice(0,i).every((n,j)=>n===current[j]));if(older){const toolchain=wanted.join('.');await run('rustup',['toolchain','install',toolchain,'--profile','minimal']);env.RUSTUP_TOOLCHAIN=toolchain;}}
 const cargo=join(root,'adapters/wasmtime/Cargo.toml');let text=await readFile(cargo,'utf8');
 for(const [name,path] of [['wasmtime','crates/wasmtime'],['wasmtime-wasi','crates/wasi'],['wasmtime-internal-jit-icache-coherence','crates/jit-icache-coherence']]){
  text=text.replace(new RegExp('('+name+' = \\{ )version = "=46\\.0\\.1"'),(_,prefix)=>prefix+'path = '+JSON.stringify(join(source,path)));
 }
 await writeFile(cargo,text);
 const workspacePackage=workspace.match(/\[workspace\.package\]([\s\S]*?)(?=\n\[|$)/)?.[1];
 const sdkVersion=workspacePackage?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
 if(!sdkVersion)throw Error('Pinned Wasmtime workspace has no SDK version');
 const sdkMajor=Number(sdkVersion.split('.')[0]);
 const legacyCompatibility=await applyLegacyWasmtimeAPI(root,sdkMajor);
 // Current Rust denies a newer lint in otherwise unchanged SDK24
 // mmap pointer-length queries. Retain the selected SDK and compiler; allow
 // this one compatibility lint without suppressing other build diagnostics.
 if(sdkMajor===24)env.RUSTFLAGS=[env.RUSTFLAGS||'', '-A dangerous_implicit_autorefs'].join(' ').trim();
 for(const entry of await (await import('node:fs/promises')).readdir(join(root,'adapters/wasmtime/src')))if(entry.endsWith('.rs')){
  const file=join(root,'adapters/wasmtime/src',entry);await writeFile(file,(await readFile(file,'utf8')).replaceAll('46.0.1',pin.revision));
 }
 const commands=join(root,'adapters/wasmtime/src/commands.rs'),p2=join(root,'adapters/wasmtime/src/p2commands.rs');
 const fsPerms=await sourceContains(join(source,'crates/wasi/src'),/pub (?:struct|enum) FsPerms/);
 if(fsPerms){
 await writeFile(commands,(await readFile(commands,'utf8')).replace('DirPerms, FilePerms,','FsPerms,').replace('DirPerms::READ, FilePerms::READ','FsPerms::ReadOnly'));
 await writeFile(p2,(await readFile(p2,'utf8')).replace('DirPerms, FilePerms,','FsPerms,').replace(/            let dir_perms = if writable \{[\s\S]*?builder\.preopened_dir\(staging\.path\(\), "\/", dir_perms, file_perms\)\?;/,'            let perms = if writable { FsPerms::ReadWrite } else { FsPerms::ReadOnly };\n            builder.preopened_dir(staging.path(), "/", perms)?;'));
 }
 provenance.compatibility={legacyCompatibility,...(sdkMajor===24?{buildCompilerCompatibility:'allow dangerous_implicit_autorefs for unchanged SDK24 mmap pointer-length code'}:{}),api:fsPerms?'FsPerms':'DirPerms/FilePerms',sourceSha256:digest(await readFile(commands)),p2Sha256:digest(await readFile(p2))};
 await run('cargo',['build','--release','--no-default-features','--manifest-path',cargo,'--bin','adapter-wasmtime']);
} else if(engine==='wasmer') {
 const selectedWasmerEnv=wasmerBuildEnvironment(env);for(const name of ['CC','CXX','HOST_CC','HOST_CXX'])if(selectedWasmerEnv[name])env[name]=selectedWasmerEnv[name];
 provenance.sdkVersion=(await readFile(join(source,'Cargo.toml'),'utf8')).split('[workspace.package]')[1]?.split('\n[')[0].match(/^version\s*=\s*"([^"]+)"/m)?.[1];
 if(!provenance.sdkVersion)throw Error('Wasmer pinned source has no SDK version');
 const wasmerSubmodules=['lib/napi'];
 if((await readFile(join(source,'.gitmodules'),'utf8')).match(/^\s*path\s*=\s*lib\/wild\s*$/m))wasmerSubmodules.push('lib/wild');
 await run('git',['submodule','update','--init','--recursive','--depth','1',...wasmerSubmodules],{cwd:source});
 provenance.sdkSubmodules=await verifySDKSubmodules(source,wasmerSubmodules,run);
 // Host exclusion prevents concurrent writers. Each pinned SDK library is
 // copied out and hashed below, so dependency reuse never changes old SDKs.
 const cacheRoot=env.WASMFYI_WASMER_BUILD_CACHE?resolve(env.WASMFYI_WASMER_BUILD_CACHE):null;
 // Older Wasmer build scripts recognize a native Cargo cache by this basename.
 const target=cacheRoot?(basename(cacheRoot)==='target'?cacheRoot:join(cacheRoot,'target')):join(source,'target'), sdk=join(directory,'wasmer-sdk');
 provenance.rustBuildCache=target;
 const llvm=pin.configurations.includes('wasmer-llvm');
 if(llvm)provenance.llvmToolchain=await configureWasmerLLVM(source,env,run);
 const features='sys-default,cranelift,singlepass,wasi,wasmer-artifact-create,wasmer-artifact-load'+(llvm?',llvm':'');
 // Optional measurement ABI returns only complete native function lengths.
 const api=await readFile(join(source,'lib/api/src/backend/sys/entities/module.rs'),'utf8');
 const artifact=await readFile(join(source,'lib/compiler/src/engine/artifact.rs'),'utf8');
 const cModule=join(source,'lib/c-api/src/wasm_c_api/module.rs');
 const getter=await wasmerNativeSizeGetter(root);
 let measurementPatchSha256=null;
 if(api.includes('pub fn sys_artifact')&&artifact.includes('pub fn finished_function_extents')){
  const current=await readFile(cModule,'utf8');if(!current.includes('fn wasmbench_module_native_function_size'))await writeFile(cModule,current+getter);
  measurementPatchSha256=digest(Buffer.from(getter));
 }

 await run('cargo',['build','--manifest-path',join(source,'lib/c-api/Cargo.toml'),'--release','--locked','--no-default-features','--features',features],{cwd:source,env:{...env,CARGO_TARGET_DIR:target}});
 await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
 for(const [from,to] of [['lib/c-api/wasmer.h','wasmer.h'],['lib/c-api/tests/wasm-c-api/include/wasm.h','wasm.h']])await cp(join(source,from),join(sdk,'include',to));
 const lib=process.platform==='darwin'?'libwasmer.dylib':'libwasmer.so';await cp(join(target,'release',lib),join(sdk,'lib',lib));
 await atomicJSON(join(sdk,'receipt.json'),{revision:pin.revision,librarySha256:digest(await readFile(join(sdk,'lib',lib))),features,measurementPatchSha256});
 await applyWasmerCraneliftAdapter(root);
 env.WASMBENCH_WASMER_SDK=sdk;await build('--runtimes','wasmer-singlepass');
 if(llvm)await build('--runtimes','wasmer-llvm');
 // Compile a second executable against the same source-pinned SDK. Building
 // through Cargo keeps all cores available and avoids an unregistered CLI name.
 // The Singlepass executable has already been copied to bin/. Reuse Cargo's
 // dependency cache, rebuilding only the compiler-specific adapter objects.
 const craneliftTarget=join(root,'adapters/native/target/wasmer-singlepass');
 await run('cargo',['build','--release','--locked','--no-default-features','--features','wasmer_singlepass','--target-dir',craneliftTarget,'--manifest-path',join(root,'adapters/native/Cargo.toml')],{env:{...env,WASMBENCH_WASMER_COMPILER:'cranelift'}});
 await cp(join(craneliftTarget,'release/adapter-native'),join(root,'bin/adapter-wasmer-cranelift'));
 provenance.cranelift={compiler:'CRANELIFT',fallback:false,adapterSourceSha256:digest(await readFile(join(root,'adapters/native/src/wasmer.cpp')))};
 provenance.sdk=sdk;
} else if(engine==='wizard') {
 provenance.sdk=await buildWizardSDK({source,root,version:pin.revision,configuration:pin.configurations[0],env,run});
} else if(engine==='graalwasm') {
 provenance.sdk=await buildGraalWasmSDK({source,root,version:pin.revision,env,run});
} else if(engine==='wasmi') {
 const cargo=join(root,'adapters/native/Cargo.toml');let manifest=await readFile(join(base,'adapters/native/Cargo.toml'),'utf8');
 const sdk=join(source,'crates/wasmi');if(!await stat(join(sdk,'Cargo.toml')).catch(()=>null))throw Error('Pinned Wasmi source has no SDK crate');
 if(!manifest.includes('wasmi = { version = "=2.0.0"'))throw Error('Frozen Wasmi dependency anchor changed');
 manifest=manifest.replace('wasmi = { version = "=2.0.0"','wasmi = { path = '+JSON.stringify(sdk));await writeFile(cargo,manifest);
 const adapter=join(root,'adapters/native/src/wasmi.rs');await writeFile(adapter,(await readFile(join(base,'adapters/native/src/wasmi.rs'),'utf8')).replace('"2.0.0".into()',JSON.stringify(pin.revision)+'.into()'));
 await applyWasmiProposals(root,sdk);
 await run('cargo',['update','--manifest-path',cargo,'-p','wasmi']);await build();
 provenance.sdk={source,sdk,revision:pin.revision,manifestSha256:digest(await readFile(cargo)),lockSha256:digest(await readFile(join(root,'adapters/native/Cargo.lock')))};
} else if(engine==='wasm3') {
 const sdk=join(directory,'wasm3-sdk'),target=join(directory,'wasm3-build');
 await run('cmake',['-S',source,'-B',target,'-DCMAKE_BUILD_TYPE=Release','-DBUILD_WASI=none',...wasm3FeatureCMakeFlags]);
 await run('cmake',['--build',target,'--target','m3','-j',String(env.WASMFYI_BUILD_JOBS||availableParallelism())]);
 await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
 for(const name of await readdir(join(source,'source')))if(name.endsWith('.h'))await cp(join(source,'source',name),join(sdk,'include',name));
 await cp(join(target,'source/libm3.a'),join(sdk,'lib/libm3.a'));
 const header=await readFile(join(sdk,'include/wasm3.h'),'utf8'),moduleMemory=/m3_GetMemory\s*\(\s*IM3Module\b/.test(header);
 const adapter=join(root,'adapters/native/src/wasm3.cpp');let embedding=await readFile(join(base,'adapters/native/src/wasm3.cpp'),'utf8');
 if(moduleMemory)embedding=embedding.replace('uint32_t size=0;auto p=m3_GetMemory(static_cast<Module*>(m)->runtime,&size,0);','size_t size=0;auto p=m3_GetMemory(static_cast<Module*>(m)->module,&size,0);');
 await writeFile(adapter,embedding);
 await applyWasm3FeaturePolicy(root);
 await applyWasm3Sampling(root);
 env.WASMBENCH_WASM3_SDK=sdk;env.WASMBENCH_WASM3_VERSION=pin.revision;
 await build();provenance.sdk={source,sdk,revision:pin.revision,librarySha256:digest(await readFile(join(sdk,'lib/libm3.a'))),flags:['Release','WASI disabled','bounds-checked memory for custom page sizes'],memoryApi:moduleMemory?'module/size_t':'runtime/uint32_t',embeddingSha256:digest(await readFile(adapter))};
} else if(engine==='wamr') {
 const configuration=pin.configurations[0];
 provenance.sdk=await buildWamrSDK({source,sdk:join(directory,'wamr-sdk'),target:join(directory,'wamr-build'),configuration,version:pin.revision,env,run});
 await build();
} else if(engine==='wasmedge') {
 provenance.sdk=await buildWasmEdgeSDK({source,sdk:join(directory,'wasmedge-sdk'),target:join(directory,'wasmedge-build'),configuration:pin.configurations[0],env,run});
 provenance.featurePolicy=await applyWasmEdgeFeaturePolicy(root,provenance.sdk.sdk,pin.configurations[0]);
 provenance.adapterWorkloadCoverage=await applyWasmEdgeWorkloadCoverage(root);
 await build();
 } else if(engine==='wavm') {
 provenance.featurePolicy=await applyWavmFeaturePolicy(source,root);
 provenance.sdk=await buildWavmSDK({source,sdk:join(directory,'wavm-sdk'),target:join(directory,'wavm-build'),harness:root,env,run});
 env.WASMBENCH_WAVM_VERSION=pin.revision;
 await build();
} else if(['wasm2c','w2c2'].includes(engine)) {
 provenance.sdk=await buildCTranspilerSDK({source,sdk:join(directory,engine+'-sdk'),target:join(directory,engine+'-build'),engine,env,run});
 if(engine==='w2c2')provenance.bridgeCompatibility=await applyW2c2Bridge(root);
 await build();
} else if(engine==='spidermonkey') {
 provenance.sdk=await buildSpiderMonkeySDK({source,target:join(directory,'spidermonkey-build'),env,run});
} else if(engine==='jsc') {
 provenance.sdk=await buildJavaScriptCoreSDK({source,target:join(directory,'jsc-build'),revision:pin.revision,env,run});
} else if(engine==='chicory') {
 provenance.sdk=await buildChicorySDK({source,root,version:pin.revision,configuration:pin.configurations[0],env,run});
} else if(engine==='v8') {
 const node=join(source,'out/Release/node');
 if(!(await stat(node).catch(()=>null))){provenance.nodeFmtStandardLibrary=await ensureNodeFmtStandardLibrary(source);const python=await nodeBuildPython(env,run),cache=await configureNodeCompilerCache(nodeBuildEnvironment(env),{source,directory,run}),buildEnv=cache.env;provenance.compilerCache=cache.provenance;provenance.nodeBuildPython=python;provenance.nodeBuildCompiler={cc:buildEnv.CC||null,cxx:buildEnv.CXX||null,cxxFlags:buildEnv.CXXFLAGS||null,linkFlags:buildEnv.LDFLAGS||null};await run(python.program,['configure.py','--without-npm'],{cwd:source,env:buildEnv});await run('make',['-j',String(env.WASMFYI_BUILD_JOBS||availableParallelism()),'PYTHON='+python.program],{cwd:source,env:buildEnv});if(cache.provenance){provenance.compilerCache.statistics=summarizeCompilerCacheStats(await readFile(cache.provenance.statsLog,'utf8'));provenance.compilerCache.summary=(await run(cache.provenance.program,['--show-log-stats'],{env:buildEnv})).output;}}
 if(!(await stat(node).catch(()=>null)))throw Error('Node source build did not produce its runtime');
 const revision=(await run('git',['rev-parse','HEAD'],{cwd:source})).output.trim();if(revision!==pin.revision)throw Error('Node build source differs');
 env.WASMBENCH_NODE=node;const v8Options=(await run(node,['--v8-options'])).output;env.WASMBENCH_V8_TURBOSHAFT_POLICY=selectV8TurboshaftPolicy(v8Options,await readFile(join(source,'deps/v8/src/wasm/function-compiler.cc'),'utf8'));provenance.wasmCompilerPolicy=env.WASMBENCH_V8_TURBOSHAFT_POLICY;env.WASMBENCH_V8_CACHE_DISABLE_FLAG=selectV8CacheDisableFlag(v8Options);provenance.nativeCacheDisableFlag=env.WASMBENCH_V8_CACHE_DISABLE_FLAG;runtimeVersion=(await run(node,['-p','JSON.stringify(process.versions)'])).output.trim();provenance.versions=JSON.parse(runtimeVersion);provenance.nodeSha256=digest(await readFile(node));
} else if(engine==='wazy') {
 const adapter=join(root,'adapters/wazy');await mkdir(adapter,{recursive:true});
 const featureDefinitions=await readFile(join(source,'api/features.go'),'utf8');
 const hasComponentPackage=Boolean(await stat(join(source,'component')).catch(()=>null));
 let coreFeaturePolicy,componentPolicy;
 for(const name of ['main.go','phases.go']){
  let text=(await readFile(join(process.cwd(),'adapters/qualification/wazy',name),'utf8')).replace('ed4381b865215e8f5e1575c382b2381422a5a8d6',pin.revision);
  if(name==='main.go'){
   ({source:text,policy:coreFeaturePolicy}=adaptWazyCoreFeatures(text,featureDefinitions));
   ({source:text,policy:componentPolicy}=adaptWazyComponents(text,hasComponentPackage));
  }
  await writeFile(join(adapter,name),text);
 }
 await run(process.execPath,['scripts/prepare-wazy-native-size.mjs',source],{cwd:process.cwd()});
 const mod=join(root,'weekly-wazy.mod');await cp(join(root,'go.mod'),mod);await cp(join(root,'go.sum'),mod.replace(/\.mod$/,'.sum'));
 await run('go',['mod','edit','-modfile='+mod,'-require=github.com/samyfodil/wazy@v0.0.0','-replace=github.com/samyfodil/wazy='+source]);
 await run('go',['build','-mod=mod','-modfile='+mod,'-trimpath','-o',join(root,'bin/adapter-wazy'),'./adapters/wazy']);
 provenance.sdk={source,revision:pin.revision,coreFeaturePolicy,componentPolicy,measurement:'module-owned native code and entry preambles',adapterSha256:digest(await readFile(join(root,'bin/adapter-wazy')))};
} else if(engine==='endive') {
 provenance.sdk=await buildEndiveSDK({source,root,version:pin.revision,configuration:pin.configurations[0],env,run});
} else if(engine==='chasm') {
 provenance.sdk=await buildChasmSDK({source,root,version:pin.revision,env,run});
} else if(engine==='zwasm') {
 provenance.sdk=await buildZwasmSDK({source,root,version:pin.revision,env,run});
} else throw Error('Unsupported weekly engine');
const configuration=pin.configurations[0];
// LLVM tools may need a build-only loader path. Qualification must see the
// same environment as measurement, with native dependencies resolved by ELF.
const runtimeEnv={...env};delete runtimeEnv.LD_LIBRARY_PATH;
const planned=join(directory,engine+'-preflight-'+randomUUID().slice(0,8)+'.json');
const preflight=startupLaunchCommand([controller,'plan','--suite',join(directory,'suite.json'),'--runtimes',configuration,'--profile','timing','--out',planned],runtimeEnv.WASMFYI_STARTUP_CPU);
await run(preflight[0],preflight.slice(1),{env:runtimeEnv});
const runtime=JSON.parse(await readFile(planned)).runtime_configurations[0];
await atomicJSON(receiptPath,{schema:1,root,controller,harnessRevision,controllerSha256:digest(await readFile(controller)),analyzerSha256:digest(await readFile(join(root,'adapters/wasmtime/target/release/wasm-analyze'))),pin,provenance,runtime,env:Object.fromEntries(Object.entries(env).filter(([k])=>k.startsWith('WASMBENCH_')||k==='JAVA_TOOL_OPTIONS')),builtAt:new Date().toISOString()});
console.log(engine,'historical source build complete');
