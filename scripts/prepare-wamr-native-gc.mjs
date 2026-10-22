// Build a separate exact-SDK numeric GC embedding; preserve the existing binding.
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
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
const identity=digest(Buffer.from(JSON.stringify({engine,revision:receipt.pin.revision,sdk:receipt.provenance?.sdk,env:receipt.env,controllerSha256:receipt.controllerSha256,cpp:digest(cpp),main:digest(await readFile(join(receipt.root,'adapters/native/src/main.rs')))})));
if(prior&&prior.identity!==identity)throw Error('Native GC binding changed; choose a new output directory');
if(!prior){
 await copyHistoricalHarness(receipt.root,harness);
 await writeFile(join(harness,'adapters/native/src/wamr.cpp'),cpp);
 const main=join(harness,'adapters/native/src/main.rs'),before=await readFile(main,'utf8');
 if(!before.includes('"standalone Rust/C embedding"'))throw Error('Native adapter description seam changed');
 const policy='native WAMR module load/validation with owned input bytes; fresh native instance and execution environment; 1 MiB stack, 16 MiB GC heap; numeric GC probes only';
 const after=before.replace('"standalone Rust/C embedding"','"WAMR native wasm_runtime API"').replace(/"C-API store allocation[^"\n]*"/,JSON.stringify(policy)).replace(' || cfg!(feature="wamr")','');
 if(!after.includes(policy))throw Error('Native adapter compile policy seam changed');
 await writeFile(main,after);
 const env={...process.env,...receipt.env,PATH:[process.env.PATH,receipt.env?.PATH].filter(Boolean).join(':'),GOWORK:'off',GOFLAGS:'-buildvcs=false'};
 for(const key of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete env[key];
 const target=join(output,'target');
 await runCommand('cargo',['build','--release','--locked','--no-default-features','--features','wamr','--target-dir',target],{cwd:join(harness,'adapters/native'),env,log:join(output,'build.log')});
 await mkdir(join(harness,'bin'),{recursive:true});
 await cp(join(target,'release/adapter-native'),join(harness,'bin','adapter-'+engine));
 await writeFile(join(output,'native-gc-build.json'),JSON.stringify({identity,engine,revision:receipt.pin.revision,harness,controller:receipt.controller,env:receipt.env,cppSha256:digest(cpp),policy,builtAt:new Date().toISOString()},null,2));
}
console.log(join(output,'native-gc-build.json'));
