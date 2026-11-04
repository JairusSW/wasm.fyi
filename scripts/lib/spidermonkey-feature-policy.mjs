import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
import {atomicJSON} from './benchmark-plan.mjs';
import {buildSpiderMonkeySDK} from './spidermonkey-sdk.mjs';
import {runCommand} from './benchmark-process.mjs';
import {createSDKBuildBudget} from './sdk-build-budget.mjs';

const marker='// wasm-fyi SpiderMonkey explicit proposal preferences v2';
const oldMarker='// wasm-fyi SpiderMonkey explicit proposal preferences v1';
const policy='spidermonkey-pref-argv-v2';
export function withSpiderMonkeyFeaturePrefs(source){
 if(source.includes(marker))return source;
 if(source.includes(oldMarker))return source.replace(oldMarker,marker).replace('args = append(args, "-P", pref+"=true")','args = append(args, "--setpref="+pref+"=true")');
 const anchor='\t\tcase "spidermonkey":\n\t\t\targs = append(args, "--wasm-compiler=ion", "-f", script, "--")';
 if(!source.includes(anchor))throw Error('SpiderMonkey preference launch seam changed');
 return source.replace(anchor,`\t\tcase "spidermonkey":\n\t\t\t${marker}\n\t\t\tfor _, pref := range strings.Fields(os.Getenv("WASMBENCH_SPIDERMONKEY_PREFS")) {\n\t\t\t\tif pref != "wasm_memory_control" && pref != "wasm_stack_switching" { return nil, true, fmt.Errorf("invalid SpiderMonkey proposal preference %q", pref) }\n\t\t\t\targs = append(args, "--setpref="+pref+"=true")\n\t\t\t}\n\t\t\targs = append(args, "--wasm-compiler=ion", "-f", script, "--")`);
}
export function availableSpiderMonkeyPrefs(output){
 return ['wasm_memory_control','wasm_stack_switching'].filter(pref=>new RegExp('^'+pref+'=(?:true|false)(?:\\s|$)','m').test(output));
}

// Caller owns the campaign build lease. Preserve the main SDK and controller;
// experimental proposal support uses a separate, source-bound feature SDK.
export async function ensureSpiderMonkeyFeatureBinding(directory,receipt,qualifiedEnv={},options={}){
 const path=join(directory,'spidermonkey-feature-binding.json');
 const cached=await readFile(path,'utf8').then(JSON.parse,()=>null);
 const sdkValid=cached?.revision===receipt.pin.revision&&await stat(cached.env.WASMBENCH_SPIDERMONKEY).catch(()=>null)&&digest(await readFile(cached.env.WASMBENCH_SPIDERMONKEY))===cached.sdk.binarySha256;
 if(sdkValid&&cached.policy===policy&&await stat(cached.controller).catch(()=>null)&&digest(await readFile(cached.controller))===cached.controllerSha256)return cached;
 const source=join(directory,'sources/spidermonkey'),harness=receipt.root;
 const env={...process.env,...qualifiedEnv,...receipt.env,GOWORK:'off',GOFLAGS:'-buildvcs=false'};
 for(const key of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete env[key];
 const log=join(directory,'spidermonkey-feature-build.log');
 const budget=createSDKBuildBudget(env),signal=options.signal?AbortSignal.any([budget.signal,options.signal]):budget.signal;
 const run=(program,args,settings={})=>runCommand(program,args,{cwd:harness,env,log,signal,...settings});
 try{
 const sdk=sdkValid?cached.sdk:await buildSpiderMonkeySDK({source,target:join(directory,'spidermonkey-feature-sdk'),env,run,maximumFeatures:true});
 const listed=await run(sdk.binary,['--list-prefs'],{check:false});
 const prefs=availableSpiderMonkeyPrefs(listed.output);
 if(!prefs.includes('wasm_memory_control')||!prefs.includes('wasm_stack_switching'))throw Error('SpiderMonkey feature preference inventory unavailable');
 const argv=prefs.flatMap(pref=>['-P',pref+'=true']);
 await run(sdk.binary,['--wasm-compiler=ion',...argv,'-e','if(!wasmMemoryControlEnabled()||!wasmStackSwitchingEnabled())throw Error("source-declared proposal activation failed")']);
 const runner=join(harness,'experiment/extra_runtimes.go');
 const before=await readFile(runner,'utf8'),after=withSpiderMonkeyFeaturePrefs(before);
 if(after!==before)await writeFile(runner,after);
 const controller=join(directory,'spidermonkey-feature-controller');
 await run('go',['build','-trimpath','-o',controller,'./cmd/wasmbench']);
 const binding={policy,revision:receipt.pin.revision,controller,controllerSha256:digest(await readFile(controller)),sdk,prefs,env:{...receipt.env,WASMBENCH_SPIDERMONKEY:sdk.binary,WASMBENCH_SPIDERMONKEY_PREFS:prefs.join(' ')},builtAt:new Date().toISOString()};
 await atomicJSON(path,binding);return binding;
 }finally{budget.dispose()}
}
