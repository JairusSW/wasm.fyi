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
const [directoryArg, engine, baseArg] = process.argv.slice(2);
const directory=resolve(directoryArg), base=resolve(baseArg), root=join(directory,'harness',engine);
const pin=JSON.parse(await readFile(join(directory,'pins.json'))).pins.find(p=>p.engine===engine);
if(!pin || pin.status!=='planned')throw Error('Missing exact source pin');
const source=join(directory,'sources',engine), receiptPath=join(directory,engine+'-build.json');
const env={...process.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',CARGO_BUILD_JOBS:'2',WASMBENCH_V8_COMPILER_MODE:'optimizing-only',NODE_OPTIONS:''};
const log=join(directory,engine+'-build.log');
const run=async(program,args,options={})=>{console.log(engine,program,args.join(' '));return runCommand(program,args,{cwd:root,env,log,...options});};
if(!(await stat(root).catch(()=>null)))await copyHistoricalHarness(base,root);
const harnessRevision=(await run('git',['-C',base,'rev-parse','HEAD'])).output.trim();
if((await run('git',['-C',base,'status','--porcelain','--untracked-files=no'])).output.trim())throw Error('Frozen harness has tracked changes');
if(!(await stat(join(root,'.git')).catch(()=>null)))await run('git',['init',root]);
await run('git',['-C',root,'add','.']);
await mkdir(join(root,'bin'),{recursive:true});
const controller=join(directory,'controller');
if(!(await stat(controller).catch(()=>null)))await run('go',['build','-trimpath','-o',controller,'./cmd/wasmbench']);
const build=async (...args)=>{
 if(engine==='wago') {
  const wrapper=join(root,'weekly-wago-build.go');
  await writeFile(wrapper,'package main\nimport ("context"; "os"; "github.com/wasmbench/wasmbench/experiment")\nfunc main(){if err:=experiment.BuildWago(context.Background(),os.Args[1],os.Args[2]);err!=nil{panic(err)}}\n');
  return run('go',['run',wrapper,root,args[args.indexOf('--wago-source')+1]]);
 }
 const configuration=pin.configurations[0],target=join(root,'adapters/native/target',configuration);
 await run('cargo',['build','--release','--locked','--no-default-features','--features',configuration.replaceAll('-','_'),'--target-dir',target],{cwd:join(root,'adapters/native')});
 await cp(join(target,'release/adapter-native'),join(root,'bin','adapter-'+configuration));
};
let runtimeVersion, provenance={...pin};
if(engine==='wago') {
 const wago=process.env.WEEKLY_WAGO_SOURCE || source;
 const revision=(await run('git',['-C',wago,'rev-parse','HEAD'])).output.trim();
 if(revision!==pin.revision || (await run('git',['-C',wago,'status','--porcelain','--untracked-files=no'])).output.trim())throw Error('Wago source pin differs or is dirty');
 const api=await readFile(join(wago,'wago.go'),'utf8');
 if(!api.includes('func NewImports(')){
  const module=JSON.parse((await run('go',['mod','download','-json','github.com/wago-org/wasi@v0.3.1'])).output);
  if(!module.Dir || !module.Sum)throw Error('WASI compatibility source receipt missing');
  const apiDirectory=join(wago,'src/wago');
  const legacyApi=(await Promise.all((await readdir(apiDirectory)).filter(f=>f.endsWith('.go')&&!f.endsWith('_test.go')).map(f=>readFile(join(apiDirectory,f),'utf8')))).join('\n');
  provenance.compatibility=await adaptLegacyWago({root,base,module,run,api:legacyApi});
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
 const cargo=join(root,'adapters/wasmtime/Cargo.toml');let text=await readFile(cargo,'utf8');
 for(const [name,path] of [['wasmtime','crates/wasmtime'],['wasmtime-wasi','crates/wasi'],['wasmtime-internal-jit-icache-coherence','crates/jit-icache-coherence']]){
  text=text.replace(new RegExp('('+name+' = \\{ )version = "=46\\.0\\.1"'),(_,prefix)=>prefix+'path = '+JSON.stringify(join(source,path)));
 }
 await writeFile(cargo,text);
 for(const entry of await (await import('node:fs/promises')).readdir(join(root,'adapters/wasmtime/src')))if(entry.endsWith('.rs')){
  const file=join(root,'adapters/wasmtime/src',entry);await writeFile(file,(await readFile(file,'utf8')).replaceAll('46.0.1',pin.revision));
 }
 const commands=join(root,'adapters/wasmtime/src/commands.rs'),p2=join(root,'adapters/wasmtime/src/p2commands.rs');
 const fsPerms=(await run('rg',['-l','pub (struct|enum) FsPerms',join(source,'crates/wasi/src')],{check:false})).code===0;
 if(fsPerms){
 await writeFile(commands,(await readFile(commands,'utf8')).replace('DirPerms, FilePerms,','FsPerms,').replace('DirPerms::READ, FilePerms::READ','FsPerms::ReadOnly'));
 await writeFile(p2,(await readFile(p2,'utf8')).replace('DirPerms, FilePerms,','FsPerms,').replace(/            let dir_perms = if writable \{[\s\S]*?builder\.preopened_dir\(staging\.path\(\), "\/", dir_perms, file_perms\)\?;/,'            let perms = if writable { FsPerms::ReadWrite } else { FsPerms::ReadOnly };\n            builder.preopened_dir(staging.path(), "/", perms)?;'));
 }
 provenance.compatibility={api:fsPerms?'FsPerms':'DirPerms/FilePerms',sourceSha256:digest(await readFile(commands)),p2Sha256:digest(await readFile(p2))};
 await run('cargo',['build','--release','--manifest-path',cargo,'--bin','adapter-wasmtime']);
} else if(engine==='wasmer') {
 provenance.sdkVersion=(await readFile(join(source,'Cargo.toml'),'utf8')).split('[workspace.package]')[1]?.split('\n[')[0].match(/^version\s*=\s*"([^"]+)"/m)?.[1];
 if(!provenance.sdkVersion)throw Error('Wasmer pinned source has no SDK version');
 await run('git',['submodule','update','--init','--depth','1','lib/napi'],{cwd:source});
 const target=join(source,'target'), sdk=join(directory,'wasmer-sdk');
 const features='sys-default,cranelift,singlepass,wasi,wasmer-artifact-create,wasmer-artifact-load';
 await run('cargo',['build','--manifest-path',join(source,'lib/c-api/Cargo.toml'),'--release','--locked','--no-default-features','--features',features],{cwd:source,env:{...env,CARGO_TARGET_DIR:target}});
 await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'lib'),{recursive:true});
 for(const [from,to] of [['lib/c-api/wasmer.h','wasmer.h'],['lib/c-api/tests/wasm-c-api/include/wasm.h','wasm.h']])await cp(join(source,from),join(sdk,'include',to));
 const lib=process.platform==='darwin'?'libwasmer.dylib':'libwasmer.so';await cp(join(target,'release',lib),join(sdk,'lib',lib));
 await atomicJSON(join(sdk,'receipt.json'),{revision:pin.revision,librarySha256:digest(await readFile(join(sdk,'lib',lib))),features});
 env.WASMBENCH_WASMER_SDK=sdk;await build('--runtimes','wasmer-singlepass');
 provenance.sdk=sdk;
} else if(engine==='wavm') {
 env.WASMBENCH_WAVM_SDK=join(homedir(),'.local/share/wasm-fyi/toolchains/wavm-nightly-2026-04-05/sdk');
 env.WASMBENCH_WAVM_VERSION='nightly-2026-04-05-'+pin.revision.slice(0,7);
 await build('--runtimes','wavm');provenance.sdk=env.WASMBENCH_WAVM_SDK;
 const sdkSource=process.platform==='darwin'?join(homedir(),'.cache/wasm-fyi/releases/WAVM-WAVM/nightly-2026-04-05'):join(env.WASMBENCH_WAVM_SDK,'../source');
 if((await run('git',['-C',sdkSource,'rev-parse','HEAD'])).output.trim()!==pin.revision)throw Error('WAVM SDK source revision differs');
 provenance.sdkSource=sdkSource;
} else if(engine==='v8') {
 const node=join(source,'out/Release/node');if(!(await stat(node).catch(()=>null)))throw Error('Node source build is not complete');
 const revision=(await run('git',['rev-parse','HEAD'],{cwd:source})).output.trim();if(revision!==pin.revision)throw Error('Node build source differs');
 env.WASMBENCH_NODE=node;runtimeVersion=(await run(node,['-p','JSON.stringify(process.versions)'])).output.trim();provenance.versions=JSON.parse(runtimeVersion);provenance.nodeSha256=digest(await readFile(node));
} else throw Error('Unsupported weekly engine');
const configuration=pin.configurations[0];
const planned=join(directory,engine+'-preflight-'+randomUUID().slice(0,8)+'.json');await run(controller,['plan','--suite',join(directory,'suite.json'),'--runtimes',configuration,'--profile','timing','--out',planned]);
const runtime=JSON.parse(await readFile(planned)).runtime_configurations[0];
await atomicJSON(receiptPath,{schema:1,root,controller,harnessRevision,controllerSha256:digest(await readFile(controller)),analyzerSha256:digest(await readFile(join(root,'adapters/wasmtime/target/release/wasm-analyze'))),pin,provenance,runtime,env:Object.fromEntries(Object.entries(env).filter(([k])=>k.startsWith('WASMBENCH_'))),builtAt:new Date().toISOString()});
console.log(engine,'historical source build complete');
