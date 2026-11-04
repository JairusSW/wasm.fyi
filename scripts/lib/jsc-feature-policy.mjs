import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
import {atomicJSON} from './benchmark-plan.mjs';
import {runCommand} from './benchmark-process.mjs';

const marker='// wasm-fyi JSC workload-scoped wide arithmetic v1';
export function withJSCFeatureFlag(source){
 if(source.includes(marker))return source;
 const anchor='\t\tcase "jsc":\n\t\t\targs = append(args, "--validateOptions=true"';
 if(!source.includes(anchor))throw Error('JSC feature flag launch seam changed');
 return source.replace(anchor,`\t\tcase "jsc":\n\t\t\t${marker}\n\t\t\tif os.Getenv("WASMBENCH_JSC_WIDE_ARITHMETIC") == "1" { args = append(args, "--useWasmWideArithmetic=true") }\n\t\t\targs = append(args, "--validateOptions=true"`);
}
// Caller holds the build lease; the native SDK and main controller stay intact.
export async function ensureJSCFeatureBinding(directory,receipt,qualifiedEnv={},signal){
 const policy='jsc-wide-arithmetic-v1',path=join(directory,'jsc-feature-binding.json');
 const cached=await readFile(path,'utf8').then(JSON.parse,()=>null);
 if(cached?.policy===policy&&cached.revision===receipt.pin.revision&&digest(await readFile(cached.controller))===cached.controllerSha256)return cached;
 const source=join(directory,'sources/jsc');
 const optionSources=await Promise.all(['Source/JavaScriptCore/runtime/OptionsList.h','Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml'].map(path=>readFile(join(source,path),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error})));
 const wideArithmetic=optionSources.some(text=>text.includes('useWasmWideArithmetic'));
 if(!wideArithmetic)return {controller:receipt.controller,wideArithmetic:false};
 const runner=join(receipt.root,'experiment/extra_runtimes.go');
 const before=await readFile(runner,'utf8'),after=withJSCFeatureFlag(before);
 if(after!==before)await writeFile(runner,after);
 const env={...process.env,...qualifiedEnv,...receipt.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
 for(const key of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete env[key];
 const controller=join(directory,'jsc-feature-controller');
 await runCommand('go',['build','-trimpath','-o',controller,'./cmd/wasmbench'],{cwd:receipt.root,env,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(300000)]):AbortSignal.timeout(300000),log:join(directory,'jsc-feature-controller.log')});
 const binding={policy,revision:receipt.pin.revision,controller,controllerSha256:digest(await readFile(controller)),wideArithmetic,builtAt:new Date().toISOString()};
 await atomicJSON(path,binding);return binding;
}
