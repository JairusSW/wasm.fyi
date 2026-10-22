import {wamrRebuildEnvironment} from './lib/wamr-rebuild-environment.mjs';
import {buildWamrSDK} from './lib/wamr-sdk.mjs';
// Build a separate exact-SDK numeric GC embedding; preserve the existing binding.
import {readFile,writeFile,mkdir,cp,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {copyHistoricalHarness} from './lib/historical-binding.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {digest} from './lib/wasmbench.mjs';
const [buildArg,outputArg,engine='wamr']=process.argv.slice(2);
if(!buildArg||!outputArg||!['wamr','wamr-llvm-jit'].includes(engine))throw Error('Usage: prepare-wamr-native-gc BUILD_DIRECTORY OUTPUT_DIRECTORY [wamr|wamr-llvm-jit]');
const build=resolve(buildArg),output=resolve(outputArg),receipt=JSON.parse(await readFile(join(build,'wamr-build.json'),'utf8'));
const harness=join(output,'harness');
await mkdir(output,{recursive:true});
const cpp=await readFile(new URL('../adapters/qualification/wamr-native.cpp',import.meta.url));
const prior=await readFile(join(output,'native-gc-build.json'),'utf8').then(JSON.parse,()=>null);
const sizePolicy=digest(await readFile(new URL('./lib/wamr-native-size.mjs',import.meta.url)));
const identity=digest(Buffer.from(JSON.stringify({sizePolicy,engine,revision:receipt.pin.revision,sdk:receipt.provenance?.sdk,env:receipt.env,controllerSha256:receipt.controllerSha256,cpp:digest(cpp),main:digest(await readFile(join(receipt.root,'adapters/native/src/main.rs')))})));
if(prior&&prior.identity!==identity)throw Error('Native GC binding changed; choose a new output directory');
if(!prior){
 const preparation=join(output,'native-gc-prepare.json');
 const prepared=await readFile(preparation,'utf8').then(JSON.parse,()=>null);
 if(await stat(harness).catch(()=>null)){
  if(prepared?.identity!==identity||prepared?.sourceRoot!==receipt.root)throw Error('Unqualified native GC directory has no matching preparation identity; choose a new output directory');
 }else{
  await writeFile(preparation,JSON.stringify({identity,sourceRoot:receipt.root})+'\n');
  await copyHistoricalHarness(receipt.root,harness);
 }
 await writeFile(join(harness,'adapters/native/src/wamr.cpp'),cpp);
 const main=join(harness,'adapters/native/src/main.rs'),before=await readFile(join(receipt.root,'adapters/native/src/main.rs'),'utf8');
 if(!before.includes('"standalone Rust/C embedding"'))throw Error('Native adapter description seam changed');
 const policy='native WAMR module load/validation with owned input bytes; fresh native instance and execution environment; 1 MiB stack, 16 MiB GC heap; numeric GC probes only';
 const after=before.replace('"standalone Rust/C embedding"','"WAMR native wasm_runtime API"').replace(/"C-API store allocation[^"\n]*"/,JSON.stringify(policy)).replace(' || cfg!(feature="wamr")','');
 if(!after.includes(policy))throw Error('Native adapter compile policy seam changed');
 await writeFile(main,after);
 const env=wamrRebuildEnvironment(receipt,{...process.env,...receipt.env,PATH:[process.env.PATH,receipt.env?.PATH].filter(Boolean).join(':'),GOWORK:'off',GOFLAGS:'-buildvcs=false'});
 for(const key of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete env[key];
 let sdk=null;
 if(engine==='wamr-llvm-jit'){
  const source=join(output,'sdk-source','wamr'),original=receipt.provenance?.sdk?.source;
  if(!original)throw Error('Pinned WAMR source path absent from SDK receipt');
  const run=(program,args,options={})=>runCommand(program,args,{cwd:harness,env,log:join(output,'sdk-build.log'),...options});
  if(!await stat(join(source,'.git')).catch(()=>null)){
   await mkdir(join(output,'sdk-source'),{recursive:true});await run('git',['clone','--shared','--no-checkout',original,source]);
  }
  await run('git',['-C',source,'checkout','--detach',receipt.pin.revision]);
  if((await run('git',['-C',source,'rev-parse','HEAD'])).output.trim()!==receipt.pin.revision)throw Error('Native GC SDK source differs from pinned revision');
  sdk=await buildWamrSDK({source,sdk:join(output,'sdk'),target:join(output,'sdk-build'),configuration:engine,version:receipt.pin.revision,env,run});
 }
 const target=join(output,'target');
 await runCommand('cargo',['build','--release','--locked','--no-default-features','--features','wamr','--target-dir',target],{cwd:join(harness,'adapters/native'),env,log:join(output,'build.log')});
 await mkdir(join(harness,'bin'),{recursive:true});
 await cp(join(target,'release/adapter-native'),join(harness,'bin','adapter-'+engine));
 if(process.platform==='linux'){
  // Preserve the already-qualified loader and dependency search closure.
  const original=receipt.runtime?.command?.[0],binary=join(harness,'bin','adapter-'+engine);
  if(!original)throw Error('Original SDK executable identity missing');
  const run=(args)=>runCommand('patchelf',args,{env,log:join(output,'build.log')});
  const interpreter=(await run(['--print-interpreter',original])).output.trim();
  const previous=(await run(['--print-rpath',original])).output.trim();
  const current=(await run(['--print-rpath',binary])).output.trim();
  await run(['--set-interpreter',interpreter,binary]);
  await run(['--set-rpath',[...new Set([...current.split(':'),...previous.split(':')].filter(Boolean))].join(':'),binary]);
 }
 await writeFile(join(output,'native-gc-build.json'),JSON.stringify({identity,engine,revision:receipt.pin.revision,harness,controller:receipt.controller,env:Object.fromEntries(Object.entries(env).filter(([key])=>key.startsWith('WASMBENCH_')||key==='JAVA_TOOL_OPTIONS')),sdk,cppSha256:digest(cpp),policy,builtAt:new Date().toISOString()},null,2));
}
console.log(join(output,'native-gc-build.json'));
