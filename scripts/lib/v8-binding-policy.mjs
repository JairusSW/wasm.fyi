import {applyV8Jspi} from './v8-jspi.mjs';
import {checkSDKStartup} from './sdk-startup.mjs';
import {readFile,writeFile,copyFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {applyV8Turboshaft,selectV8TurboshaftPolicy} from './v8-turboshaft.mjs';
import {applyV8CacheFlag,selectV8CacheDisableFlag,v8CacheDisableFlags} from './v8-cache-flag.mjs';import {applyV8SingleCoreMode} from './v8-single-core-mode.mjs';import {applyV8NativeSizePolicy} from './v8-native-size-policy.mjs';
import {withBuildLock} from './measurement-lock.mjs';import {runCommand} from './benchmark-process.mjs';import {atomicJSON} from './benchmark-plan.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function describedV8Binding(planned, metadata, policy) {
 const runtime={...planned,description:metadata?.description};
 if(runtime.description?.backend!=='turboshaft'||runtime.description?.effective_configuration?.wasm_compiler_policy!==policy)throw Error('Corrected V8 binding did not establish declared pipeline');
 return runtime;
}
// Upgrade only measurement harness/controller; retain the installed Node SDK.
export async function ensureV8BindingPolicy(campaign,directory,receipt,{reserved=false,env:qualifiedEnv={},featureJspi=false}={}){
 if(receipt.runtime?.description?.backend==='turboshaft'&&receipt.env?.WASMBENCH_V8_TURBOSHAFT_POLICY&&v8CacheDisableFlags.includes(receipt.env?.WASMBENCH_V8_CACHE_DISABLE_FLAG)&&(!featureJspi||(receipt.provenance?.featureJspiAdapter&&receipt.provenance?.featureFreshSampling&&receipt.provenance?.featureCoverageAdapter)))return receipt;
 const migrate=async()=>{
  const root=receipt.root,node=receipt.env.WASMBENCH_NODE,source=join(directory,'sources/v8');
  const env={...process.env,...qualifiedEnv,...receipt.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',NODE_OPTIONS:''};
  for(const key of ['GOMAXPROCS','OMP_NUM_THREADS','RAYON_NUM_THREADS','CARGO_BUILD_JOBS','CMAKE_BUILD_PARALLEL_LEVEL','MAKEFLAGS','UV_THREADPOOL_SIZE'])delete env[key];
  const log=join(directory,'turboshaft-binding.log'),run=(program,args,options={})=>runCommand(program,args,{cwd:root,env,log,...options});
  const before=hash(await readFile(node));if(!receipt.provenance?.nodeSha256||before!==receipt.provenance.nodeSha256)throw Error('Cached Node binary differs from sealed SDK receipt');const revision=(await run('git',['rev-parse','HEAD'],{cwd:source})).output.trim();if(!/^[a-f0-9]{40}$/.test(receipt.pin?.revision||'')||revision!==receipt.pin.revision)throw Error('Cached V8 source revision differs from SDK receipt');const options=(await run(node,['--v8-options'])).output;
  let compilerSource='',compilerPath='deps/v8/src/wasm/function-compiler.cc';
  try{compilerSource=await readFile(join(source,compilerPath),'utf8')}catch(error){if(error.code!=='ENOENT')throw error;
   const exact=await run('git',['show',revision+':'+compilerPath],{cwd:source,check:false});
   if(exact.code===0||exact.exitCode===0||exact.output.includes('ExecuteTurboshaftWasmCompilation'))compilerSource=exact.output;
   const candidates=(await run('git',['ls-tree','-r','--name-only',revision,'--','deps/v8/src/wasm'],{cwd:source})).output.split('\n').filter(p=>/(?:function|module|wasm|compilation).*\.cc$/.test(p));
   for(const path of compilerSource?[]:candidates){const blob=await run('git',['show',revision+':'+path],{cwd:source});if(blob.output.includes('ExecuteTurboshaftWasmCompilation')&&!blob.output.includes('ExecuteTurbofanWasmCompilation')){compilerPath=path;compilerSource=blob.output;break;}}
   if(!compilerSource)throw Error('Pinned V8 compiler policy source unavailable in exact Git tree');
  }
  const policy=selectV8TurboshaftPolicy(options,compilerSource),cacheFlag=selectV8CacheDisableFlag(options);
  await copyFile(join(directory,'v8-build.json'),join(directory,'v8-build.before-turboshaft-'+randomUUID()+'.json'));
  if(featureJspi)await applyV8Jspi(root);
  await applyV8SingleCoreMode(root);await applyV8CacheFlag(root);await applyV8NativeSizePolicy(root);await applyV8Turboshaft(root);
  await run('git',['add','.']);await run('git',['-c','user.name=wasmfyi benchmark harness','-c','user.email=benchmark@localhost','commit','--allow-empty','-m','Identify pinned Wasm Turboshaft pipeline']);
  await run('go',['build','-trimpath','-o',receipt.controller,'./cmd/wasmbench']);
  env.WASMBENCH_V8_TURBOSHAFT_POLICY=policy;env.WASMBENCH_V8_CACHE_DISABLE_FLAG=cacheFlag;env.WASMBENCH_SINGLE_CORE='1';
  const plan=join(directory,'turboshaft-binding-'+randomUUID()+'.json');
  const argv=[receipt.controller,'plan','--suite',join(directory,'suite.json'),'--runtimes','v8','--profile','timing','--out',plan];if(process.platform==='linux')await run('taskset',['-c',env.WASMFYI_STARTUP_CPU||'2',...argv],{env});else await run(argv[0],argv.slice(1),{env});
  const planned=JSON.parse(await readFile(plan)).runtime_configurations[0],metadata=await checkSDKStartup(planned.command,{cwd:root,env,cpu:process.platform==='linux'?'2':undefined});const runtime=describedV8Binding(planned,metadata,policy);
  if(hash(await readFile(node))!==before)throw Error('Installed Node changed during harness-only migration');
  const next={...receipt,controllerSha256:hash(await readFile(receipt.controller)),runtime,env:{...receipt.env,WASMBENCH_V8_TURBOSHAFT_POLICY:policy,WASMBENCH_V8_CACHE_DISABLE_FLAG:cacheFlag},provenance:{...receipt.provenance,wasmCompilerPolicy:policy,nativeCacheDisableFlag:cacheFlag,...(featureJspi?{featureJspiAdapter:true,featureFreshSampling:true,featureCoverageAdapter:true}:{}),turboshaftCompilerSource:{path:compilerPath,sha256:hash(Buffer.from(compilerSource)),revision},turboshaftMetadata:metadata},measurementBindingUpdatedAt:new Date().toISOString()};await atomicJSON(join(directory,'v8-build.json'),next);return next;
 };
 return reserved?migrate():withBuildLock(campaign,migrate);
}
