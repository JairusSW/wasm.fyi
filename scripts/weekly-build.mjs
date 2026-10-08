// Build the Saturday default-branch snapshots in an isolated native harness.
import {readFile, writeFile, mkdir, cp, stat, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
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
import {buildWavmSDK} from './lib/wavm-sdk.mjs';
import {buildChicorySDK} from './lib/chicory-sdk.mjs';
import {buildCTranspilerSDK} from './lib/c-transpiler-sdk.mjs';
import {buildSpiderMonkeySDK} from './lib/spidermonkey-sdk.mjs';
import {buildJavaScriptCoreSDK} from './lib/jsc-sdk.mjs';
const [directoryArg, engine, baseArg] = process.argv.slice(2);
const directory=resolve(directoryArg), base=resolve(baseArg), root=join(directory,'harness',engine);
const pin=JSON.parse(await readFile(join(directory,'pins.json'))).pins.find(p=>p.engine===engine);
if(!pin || pin.status!=='planned')throw Error('Missing exact source pin');
const source=join(directory,'sources',engine), receiptPath=join(directory,engine+'-build.json');
const env={...process.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',CARGO_BUILD_JOBS:'2',WASMBENCH_V8_COMPILER_MODE:'optimizing-only',NODE_OPTIONS:''};
const log=join(directory,engine+'-build.log');
const run=async(program,args,options={})=>{console.log(engine,program,args.join(' '));return runCommand(program,args,{cwd:root,env,log,...options});};
if(!(await stat(root).catch(()=>null)))await copyHistoricalHarness(base,root);
if(['jsc','spidermonkey','chicory'].includes(engine)) {
 for(const path of ['adapters/js-shell/adapter.js','adapters/js-shell/jsc-host.cpp','experiment/extra_runtimes.go','experiment/extra_runtimes_test.go','experiment/runner.go'])await cp(join(base,path),join(root,path));
}
const harnessRevision=(await run('git',['-C',base,'rev-parse','HEAD'])).output.trim();
if((await run('git',['-C',base,'status','--porcelain','--untracked-files=no'])).output.trim())throw Error('Frozen harness has tracked changes');
if(!(await stat(join(root,'.git')).catch(()=>null)))await run('git',['init',root]);
await run('git',['-C',root,'add','.']);
await mkdir(join(root,'bin'),{recursive:true});
const controller=join(directory,'controller');
if(['jsc','spidermonkey','chicory'].includes(engine)||!(await stat(controller).catch(()=>null)))await run('go',['build','-trimpath','-o',controller,'./cmd/wasmbench']);
const build=async (...args)=>{
 if(engine==='wago') {
  const wrapper=join(root,'weekly-wago-build.go');
  await writeFile(wrapper,'package main\nimport ("context"; "os"; "github.com/wasmbench/wasmbench/experiment")\nfunc main(){if err:=experiment.BuildWago(context.Background(),os.Args[1],os.Args[2]);err!=nil{panic(err)}}\n');
  return run('go',['run',wrapper,root,args[args.indexOf('--wago-source')+1]]);
 }
 const configuration=pin.configurations[0],aot=['wasm2c','w2c2'].includes(engine),target=join(root,'adapters/native/target',aot?'aot':configuration);
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
 await build('--runtimes','wago','--wago-source',wago);
} else if(engine==='wazero') {
 const download=JSON.parse((await run('go',['mod','download','-json','github.com/tetratelabs/wazero@'+pin.revision])).output);
 if(!download.Version || !download.Sum || download.Origin?.Hash!==pin.revision)throw Error('Wazero module receipt differs from source pin');
 const mod=join(root,'weekly-wazero.mod');await cp(join(root,'go.mod'),mod);await cp(join(root,'go.sum'),mod.replace(/\.mod$/,'.sum'));
 await run('go',['mod','edit','-modfile='+mod,'-require=github.com/tetratelabs/wazero@'+download.Version]);
 for(const entry of await (await import('node:fs/promises')).readdir(join(root,'adapters/wazero')))if(entry.endsWith('.go')){
  const file=join(root,'adapters/wazero',entry);await writeFile(file,(await readFile(join(base,'adapters/wazero',entry),'utf8')).replaceAll('1.12.0',download.Version.replace(/^v/,'')));
 }
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
 for(const entry of await (await import('node:fs/promises')).readdir(join(root,'adapters/wasmtime/src')))if(entry.endsWith('.rs')){
  const file=join(root,'adapters/wasmtime/src',entry);await writeFile(file,(await readFile(file,'utf8')).replaceAll('46.0.1',pin.revision));
 }
 const commands=join(root,'adapters/wasmtime/src/commands.rs'),p2=join(root,'adapters/wasmtime/src/p2commands.rs');
 const fsPerms=await sourceContains(join(source,'crates/wasi/src'),/pub (?:struct|enum) FsPerms/);
 if(fsPerms){
 await writeFile(commands,(await readFile(commands,'utf8')).replace('DirPerms, FilePerms,','FsPerms,').replace('DirPerms::READ, FilePerms::READ','FsPerms::ReadOnly'));
 await writeFile(p2,(await readFile(p2,'utf8')).replace('DirPerms, FilePerms,','FsPerms,').replace(/            let dir_perms = if writable \{[\s\S]*?builder\.preopened_dir\(staging\.path\(\), "\/", dir_perms, file_perms\)\?;/,'            let perms = if writable { FsPerms::ReadWrite } else { FsPerms::ReadOnly };\n            builder.preopened_dir(staging.path(), "/", perms)?;'));
 }
 provenance.compatibility={api:fsPerms?'FsPerms':'DirPerms/FilePerms',sourceSha256:digest(await readFile(commands)),p2Sha256:digest(await readFile(p2))};
 await run('cargo',['build','--release','--no-default-features','--manifest-path',cargo,'--bin','adapter-wasmtime']);
} else if(engine==='wasmer') {
 provenance.sdkVersion=(await readFile(join(source,'Cargo.toml'),'utf8')).split('[workspace.package]')[1]?.split('\n[')[0].match(/^version\s*=\s*"([^"]+)"/m)?.[1];
 if(!provenance.sdkVersion)throw Error('Wasmer pinned source has no SDK version');
 await run('git',['submodule','update','--init','--depth','1','lib/napi'],{cwd:source});
 const target=join(source,'target'), sdk=join(directory,'wasmer-sdk');
 const llvm=pin.configurations[0]==='wasmer-llvm';
 if(llvm)provenance.llvmToolchain=await configureWasmerLLVM(source,env,run);
 const features='sys-default,cranelift,singlepass,wasi,wasmer-artifact-create,wasmer-artifact-load'+(llvm?',llvm':'');
 // Optional measurement ABI returns only complete native function lengths.
 const api=await readFile(join(source,'lib/api/src/backend/sys/entities/module.rs'),'utf8');
 const artifact=await readFile(join(source,'lib/compiler/src/engine/artifact.rs'),'utf8');
 const cModule=join(source,'lib/c-api/src/wasm_c_api/module.rs');
 const getter=await readFile(join(root,'adapters/native/wasmer-native-size.rs'),'utf8');
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
 env.WASMBENCH_WASMER_SDK=sdk;await build('--runtimes','wasmer-singlepass');
 provenance.sdk=sdk;
} else if(engine==='wasmi') {
 const cargo=join(root,'adapters/native/Cargo.toml');let manifest=await readFile(join(base,'adapters/native/Cargo.toml'),'utf8');
 const sdk=join(source,'crates/wasmi');if(!await stat(join(sdk,'Cargo.toml')).catch(()=>null))throw Error('Pinned Wasmi source has no SDK crate');
 if(!manifest.includes('wasmi = { version = "=2.0.0"'))throw Error('Frozen Wasmi dependency anchor changed');
 manifest=manifest.replace('wasmi = { version = "=2.0.0"','wasmi = { path = '+JSON.stringify(sdk));await writeFile(cargo,manifest);
 const adapter=join(root,'adapters/native/src/wasmi.rs');await writeFile(adapter,(await readFile(join(base,'adapters/native/src/wasmi.rs'),'utf8')).replace('"2.0.0".into()',JSON.stringify(pin.revision)+'.into()'));
 await run('cargo',['update','--manifest-path',cargo,'-p','wasmi']);await build();
 provenance.sdk={source,sdk,revision:pin.revision,manifestSha256:digest(await readFile(cargo)),lockSha256:digest(await readFile(join(root,'adapters/native/Cargo.lock')))};
} else if(engine==='wasm3') {
 const sdk=join(directory,'wasm3-sdk'),target=join(directory,'wasm3-build');
 await run('cmake',['-S',source,'-B',target,'-DCMAKE_BUILD_TYPE=Release','-DBUILD_WASI=none']);
 await run('cmake',['--build',target,'--target','m3','-j','2']);
 await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
 for(const name of await readdir(join(source,'source')))if(name.endsWith('.h'))await cp(join(source,'source',name),join(sdk,'include',name));
 await cp(join(target,'source/libm3.a'),join(sdk,'lib/libm3.a'));
 const header=await readFile(join(sdk,'include/wasm3.h'),'utf8'),moduleMemory=/m3_GetMemory\s*\(\s*IM3Module\b/.test(header);
 const adapter=join(root,'adapters/native/src/wasm3.cpp');let embedding=await readFile(join(base,'adapters/native/src/wasm3.cpp'),'utf8');
 if(moduleMemory)embedding=embedding.replace('uint32_t size=0;auto p=m3_GetMemory(static_cast<Module*>(m)->runtime,&size,0);','size_t size=0;auto p=m3_GetMemory(static_cast<Module*>(m)->module,&size,0);');
 await writeFile(adapter,embedding);
 env.WASMBENCH_WASM3_SDK=sdk;env.WASMBENCH_WASM3_VERSION=pin.revision;
 await build();provenance.sdk={source,sdk,revision:pin.revision,librarySha256:digest(await readFile(join(sdk,'lib/libm3.a'))),flags:['Release','WASI disabled'],memoryApi:moduleMemory?'module/size_t':'runtime/uint32_t',embeddingSha256:digest(Buffer.from(embedding))};
} else if(engine==='wamr') {
 const configuration=pin.configurations[0];
 provenance.sdk=await buildWamrSDK({source,sdk:join(directory,'wamr-sdk'),target:join(directory,'wamr-build'),configuration,version:pin.revision,env,run});
 await build();
} else if(engine==='wasmedge') {
 provenance.sdk=await buildWasmEdgeSDK({source,sdk:join(directory,'wasmedge-sdk'),target:join(directory,'wasmedge-build'),configuration:pin.configurations[0],env,run});
 await build();
 } else if(engine==='wavm') {
 provenance.sdk=await buildWavmSDK({source,sdk:join(directory,'wavm-sdk'),target:join(directory,'wavm-build'),env,run});
 env.WASMBENCH_WAVM_VERSION=pin.revision;
 await build();
} else if(['wasm2c','w2c2'].includes(engine)) {
 provenance.sdk=await buildCTranspilerSDK({source,sdk:join(directory,engine+'-sdk'),target:join(directory,engine+'-build'),engine,env,run});
 await build();
} else if(engine==='spidermonkey') {
 provenance.sdk=await buildSpiderMonkeySDK({source,target:join(directory,'spidermonkey-build'),env,run});
} else if(engine==='jsc') {
 provenance.sdk=await buildJavaScriptCoreSDK({source,target:join(directory,'jsc-build'),revision:pin.revision,env,run});
} else if(engine==='chicory') {
 provenance.sdk=await buildChicorySDK({source,root,version:pin.revision,env,run});
} else if(engine==='v8') {
 const node=join(source,'out/Release/node');
 if(!(await stat(node).catch(()=>null))){await run('python3',['configure.py','--without-npm'],{cwd:source});await run('make',['-j','2'],{cwd:source});}
 if(!(await stat(node).catch(()=>null)))throw Error('Node source build did not produce its runtime');
 const revision=(await run('git',['rev-parse','HEAD'],{cwd:source})).output.trim();if(revision!==pin.revision)throw Error('Node build source differs');
 env.WASMBENCH_NODE=node;runtimeVersion=(await run(node,['-p','JSON.stringify(process.versions)'])).output.trim();provenance.versions=JSON.parse(runtimeVersion);provenance.nodeSha256=digest(await readFile(node));
} else throw Error('Unsupported weekly engine');
const configuration=pin.configurations[0];
const planned=join(directory,engine+'-preflight-'+randomUUID().slice(0,8)+'.json');await run(controller,['plan','--suite',join(directory,'suite.json'),'--runtimes',configuration,'--profile','timing','--out',planned]);
const runtime=JSON.parse(await readFile(planned)).runtime_configurations[0];
await atomicJSON(receiptPath,{schema:1,root,controller,harnessRevision,controllerSha256:digest(await readFile(controller)),analyzerSha256:digest(await readFile(join(root,'adapters/wasmtime/target/release/wasm-analyze'))),pin,provenance,runtime,env:Object.fromEntries(Object.entries(env).filter(([k])=>k.startsWith('WASMBENCH_'))),builtAt:new Date().toISOString()});
console.log(engine,'historical source build complete');
