import {withBuildLock} from './lib/measurement-lock.mjs';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {historyBuildDirectory} from './lib/history-build-cache.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {repairCaptureCode} from './repair-capture-code.mjs';
const [rootArg,configuration]=process.argv.slice(2),root=resolve(rootArg);
if(!['wamr-fast-jit','wamr-llvm-jit'].includes(configuration))throw Error('WAMR JIT backend required');
const template=JSON.parse(await readFile(join(root,'collection-template.json'))),plan=JSON.parse(await readFile(join(root,'source-plan.json'))),pin=plan.pins.find(p=>p.engine==='wamr'&&p.status==='planned');
while(true){const status=await readFile(join(root,'wamr-supplement-history-status.json'),'utf8').then(JSON.parse,()=>null);if(status?.completed?.some(done=>done.configuration===configuration))break;await new Promise(r=>setTimeout(r,10000));}
const directory=await historyBuildDirectory(root,pin,configuration),receipt=JSON.parse(await readFile(join(directory,'wamr-build.json'))),harness=receipt.root;
const path=join(harness,'adapters/native/src/main.rs');let text=await readFile(path,'utf8');
text=text.replace('#[cfg(any(feature = "wasmer_singlepass", feature = "wasmer_llvm"))]\n                let native_size_profile', '#[cfg(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge"))]\n                let native_size_profile');
text=text.replace('#[cfg(not(any(feature = "wasmer_singlepass", feature = "wasmer_llvm")))]\n                let native_size_profile', '#[cfg(not(any(feature = "wasmer_singlepass", feature = "wasmer_llvm", feature = "wamr", feature = "wasmedge")))]\n                let native_size_profile');
await writeFile(path,text);
const target=join(harness,'adapters/native/target',configuration),env={...process.env,...template.env,...receipt.env,CARGO_BUILD_JOBS:template.env?.WASMFYI_BUILD_JOBS||'1',WASMBENCH_WAMR_MODE:configuration.slice(5)};
await withBuildLock(root,async()=>{
await runCommand('cargo',['build','--manifest-path',join(harness,'adapters/native/Cargo.toml'),'--release','--locked','--no-default-features','--features','wamr','--target-dir',target],{cwd:harness,env,log:join(root,configuration+'-adapter-repair.log')});
await copyFile(join(target,'release/adapter-native'),receipt.runtime.command[0]);
});
await repairCaptureCode(root,configuration);
