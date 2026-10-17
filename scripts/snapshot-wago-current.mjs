import {homedir} from 'node:os';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {copyHistoricalHarness} from './lib/historical-binding.mjs';
import {readCache,atomicJSON} from './lib/benchmark-plan.mjs';
import {withWagoDirectIdentity,WAGO_IDENTITY_EMBEDDING,WAGO_IDENTITY_POLICY} from './lib/wago-direct-identity.mjs';
import {applyWagoColdCompile} from './lib/wago-cold-compile.mjs';
import {applyWagoThreads,WAGO_THREADS_POLICY} from './lib/wago-threads.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
const [rootArg,manifestArg]=process.argv.slice(2),r=resolve(rootArg),request=JSON.parse(await readFile(resolve(manifestArg))),directory=join(r,'wago-current-priority',request.id),sdk=join(directory,'sdk-'+WAGO_IDENTITY_EMBEDDING),source=join(sdk,'sources/wago'),harness=join(sdk,'harness/wago'),revision=request.source.revision;
if(!/^[a-f0-9]{40}$/.test(revision)||!/^[a-zA-Z0-9_-]+$/.test(request.id))throw Error('Invalid exact snapshot identity');
if(process.platform==='darwin'){const owner=JSON.parse(await readFile(join(homedir(),'.benchmark-lock/owner.json')));if(owner.workload_pid!==process.pid)throw Error('Snapshot build requires actual global device claim');const schedule=JSON.parse(await readFile(join(r,'device-schedule.json')));if(schedule.breakUntil>Date.now()/1000||1800-(schedule.ownedSeconds||0)<120)process.exit(75);}
await mkdir(directory,{recursive:true});const template=JSON.parse(await readFile(join(r,'collection-template.json'))),env={...process.env,...template.env,WASMBENCH_SHARED_DEVICE_RESERVED:'1',WASMFYI_HISTORY_FAST:'1',GOWORK:'off',GOFLAGS:'-buildvcs=false',GOMAXPROCS:String(template.env.WASMFYI_BUILD_JOBS||8)};
for(const key of ['WASMBENCH_SINGLE_CORE','OMP_NUM_THREADS','RAYON_NUM_THREADS'])delete env[key];
const abort=new AbortController();for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>abort.abort());const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(90*60*1000)]),log=join(directory,'build.log');
const run=async(program,args,cwd=harness)=>{const result=await runCommand(program,args,{cwd,env,signal,log});return result.output.trim();};
let release;try{release=await acquireMeasurementLock(join(r,'measurement-lock'),AbortSignal.timeout(2000));}catch(e){if(['AbortError','TimeoutError'].includes(e.name))process.exit(75);throw e;}
try{
 const inventory=new Map(template.workloads.map(w=>[w.id,w.sha256])),suite=(await readCache(template.corpusRoot)).filter(w=>inventory.has(w.id));if(suite.length!==148)throw Error('Missing default148 corpus');
 await mkdir(sdk,{recursive:true});const receiptPath=join(sdk,'wago-build.json');let receipt=await readFile(receiptPath).then(JSON.parse,()=>null);let reusedSDK=Boolean(receipt);if(receipt&&(receipt.hostCallbackPolicy!==WAGO_IDENTITY_POLICY||receipt.threadFeaturePolicy!==WAGO_THREADS_POLICY||!await stat(receipt.controller).catch(()=>null)||!await stat(join(receipt.root,'bin/adapter-wago')).catch(()=>null))){receipt=null;reusedSDK=false;}
 if(!receipt){
  await mkdir(source,{recursive:true});if(!await stat(join(source,'.git')).catch(()=>null)){await run('git',['init',source],directory);await run('git',['-C',source,'remote','add','origin',request.sourceRepository||'https://github.com/wago-org/wago.git'],directory);}
  const exists=await run('git',['-C',source,'cat-file','-t',revision],directory).then(x=>x==='commit',()=>false);if(!exists)await run('git',['-C',source,'fetch','--depth','1','origin',revision],directory);
  await run('git',['-C',source,'checkout','--detach',revision],directory);
  if(await run('git',['-C',source,'rev-parse','HEAD'],directory)!==revision)throw Error('Exact snapshot source differs');
  if(!await stat(harness).catch(()=>null))await copyHistoricalHarness(join(r,'frozen-harness'),harness);
  const adapter=join(harness,'adapters/wago/main.go');await writeFile(adapter,withWagoDirectIdentity(await readFile(adapter,'utf8')));
  await run(process.execPath,[join(r,'site/scripts/apply-controller-sampling.mjs'),harness]);await applyWagoColdCompile(harness);
  const threadAPI=await readFile(join(source,'src/wago/config.go'),'utf8').catch(async e=>{if(e.code!=='ENOENT')throw e;return readFile(join(source,'config.go'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e})});const threads=await applyWagoThreads(harness,threadAPI);
  const controller=join(sdk,'controller');await run('go',['build','-trimpath','-o',controller,'./cmd/wasmbench']);
  const wrapper=join(harness,'current-wago-build.go');await writeFile(wrapper,'package main\nimport("context";"os";"github.com/wasmbench/wasmbench/experiment")\nfunc main(){if err:=experiment.BuildWago(context.Background(),os.Args[1],os.Args[2]);err!=nil{panic(err)}}\n');
  if(!await stat(join(harness,'.git')).catch(()=>null))await run('git',['init',harness]);
  await run('git',['-C',harness,'add','.']);
  await run('git',['-C',harness,'-c','user.name=wasmfyi snapshot','-c','user.email=benchmark@localhost','commit','--allow-empty','-m','Isolated direct-callback snapshot harness']);
  await run('go',['run',wrapper,harness,source]);
  receipt={root:harness,controller,pin:{revision},env:{},builtAt:new Date().toISOString(),source:request.source,hostCallbackPolicy:WAGO_IDENTITY_POLICY,threadFeaturePolicy:WAGO_THREADS_POLICY,threads};await atomicJSON(receiptPath,receipt);
 }
 if(receipt.pin.revision!==revision||receipt.hostCallbackPolicy!==WAGO_IDENTITY_POLICY||receipt.threadFeaturePolicy!==WAGO_THREADS_POLICY)throw Error('Cached SDK differs from requested snapshot');
 const job={id:request.id+'-'+WAGO_IDENTITY_EMBEDDING,engine:'wago',harness:receipt.root,controller:receipt.controller,env:receipt.env,historical:false,source:request.source};
 await atomicJSON(join(directory,'plan.json'),{...template,env:{...template.env,WASMFYI_HISTORY_FAST:'1'},collection:{...template.collection,memory:true,code:true,warmup:0,wagoSource:source},captureDirectory:request.captureDirectory||join(r,'captures'),jobs:[job]});
 await atomicJSON(join(directory,'ready.json'),{at:new Date().toISOString(),source:request.source,sdkReceipt:receiptPath,reusedSDK,noProofRuns:true,sourcePlanUnchanged:true});
}finally{await release();}
