// The Go CLI owns run state and SQL writes. This worker owns source-bound SDK
// preparation and one workload capture; stdout is a bounded JSONL protocol.
import {readFile,writeFile,mkdir,stat,cp,rm,readdir,realpath} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {cpus,totalmem,platform,arch,homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {engines,resolveEngine,selectCorpora} from './registry.mjs';
import {snapshotSource,checkoutSource} from './source.mjs';
import {site,config,digest} from '../lib/wasmbench.mjs';
import {runCommand} from '../lib/benchmark-process.mjs';
import {collectLatencies,latencyCollection} from '../lib/latency-capture.mjs';
import {samplePolicy} from '../lib/sample-stability.mjs';
import {workloadContract} from '../lib/workload-contract.mjs';
import {measurementLaunch} from '../lib/measurement-launch.mjs';
import {featureScenarios} from '../lib/feature-scenario-policy.mjs';
import {parseCorpusJSON} from '../lib/corpus.mjs';
import {historyWorkloadFailure} from '../lib/history-workload-failure.mjs';
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
console.log=(...values)=>process.stderr.write(values.join(' ')+'\n');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const readCorpus=async path=>parseCorpusJSON(await readFile(path,'utf8'));
const exists=async path=>!!await stat(path).catch(()=>null);
const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32<<20,stdio:['ignore','pipe','pipe']}).trim();
async function policyHash(){
 const hash=createHash('sha256');
 async function walk(path){for(const e of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(path,e.name);if(e.isDirectory()){if(!['.git','target','node_modules','build'].includes(e.name))await walk(file);}else if(!e.name.includes('.test.')&&/\.(?:go|rs|mjs|py|patch)$/.test(e.name))hash.update(file.slice(site.length)).update(await readFile(file));}}
 for(const p of ['scripts/local','scripts/lib','adapters','patches'])await walk(join(site,p));hash.update(await readFile(join(site,'scripts/weekly-build.mjs')));return hash.digest('hex');
}
const callIds=['mechanisms/host-to-wasm-call','mechanisms/wasm-to-host-call','mechanisms/wasm-host-wasm-loop'];
async function catalogue(){
 const main=(await readCorpus(join(site,'corpora/applications/manifest.json'))).map(w=>({...w,artifact:resolve(site,'corpora/applications',w.artifact),source:w.source?resolve(site,'corpora/applications',w.source):undefined}));
 const features=(await readCorpus(join(site,'corpora/features/manifest.json'))).map(w=>({...w,artifact:resolve(site,'corpora/features',w.artifact),source:w.source?resolve(site,'corpora/features',w.source):undefined}));
 return [...main,...features];
}
async function harness(cache,offline,policy){
 const settings={...await config(),harnessSource:{repository:'https://github.com/JairusSW/wasm-bench.git',revision:'a017c56fef370a54ffa33ca49ad9b6827e127cc4'}},base=join(cache,'tools','harness-'+policy.slice(0,16));
 if(await exists(join(base,'.wasmfyi-prepared')))return base;
 if(await exists(base))await rm(base,{recursive:true,force:true});
 await mkdir(base,{recursive:true});
 const origin=resolve(site,settings.root);
 if(await exists(join(origin,'.git'))){
  execFileSync('git',['clone','--no-hardlinks','--no-checkout',origin,base],{stdio:['ignore',2,2]});
  // A supplied qualified harness is frozen at its committed revision.
  try{git(base,['checkout','--detach',settings.harnessSource.revision])}catch{if(offline)throw Error('Pinned measurement harness is not cached; run once online');execFileSync('git',['-C',base,'fetch','--depth=1',settings.harnessSource.repository,settings.harnessSource.revision],{stdio:['ignore',2,2]});git(base,['checkout','--detach',settings.harnessSource.revision]);}
 }else{
  if(offline)throw Error('The pinned measurement harness is not cached; run once online');
  git(base,['init']);git(base,['remote','add','origin',settings.harnessSource.repository]);execFileSync('git',['-C',base,'fetch','--depth=1','origin',settings.harnessSource.revision],{stdio:['ignore',2,2]});git(base,['checkout','--detach',settings.harnessSource.revision]);
 }
 git(base,['apply',join(site,'patches/local-call-loop.patch')]);
 await runCommand(process.execPath,[join(site,'scripts/apply-controller-sampling.mjs'),base],{cwd:site,quiet:true,log:join(cache,'prepare.log')});
 git(base,['add','-A']);git(base,['-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','-c','user.name=wasmfyi','-c','user.email=local@localhost','commit','--allow-empty','-qm','Freeze local measurement policy '+policy]);
 await writeFile(join(base,'.wasmfyi-prepared'),policy);return base;
}
function measurementCPU(){
 if(platform()!=='linux')return null;
 const status=execFileSync('cat',['/proc/self/status'],{encoding:'utf8'}),list=status.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1];
 const allowed=(list||'0').trim().split(',').flatMap(p=>{const [a,b=a]=p.split('-').map(Number);return Array.from({length:b-a+1},(_,i)=>a+i)});
 const score=cpu=>{for(const file of ['cpu_capacity','topology/core_type','cpufreq/cpuinfo_max_freq'])try{return Number(execFileSync('cat',[`/sys/devices/system/cpu/cpu${cpu}/${file}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']}))}catch{}return 0};
 return allowed.sort((a,b)=>score(b)-score(a)||a-b)[0];
}
export async function prepare(options){
 const cache=resolve(options.cache);await mkdir(cache,{recursive:true});const policy=await policyHash();
 const selected=[...new Map(options.engines.map(resolveEngine).map(e=>[e.id+'@'+e.ref,e])).values()];
 const selectors=options.corpora.length?options.corpora:['main'];let inventory=await catalogue();
 if(options.dryRun)inventory.push(...callIds.map(id=>({id,generated:true})));
 const wantsCalls=selectors.some(s=>s==='main'||s.startsWith('mechanisms'));
 const base=options.dryRun?null:await harness(cache,options.offline,policy);
 if(wantsCalls&&base){
  const dir=join(cache,'artifacts','calls-'+policy.slice(0,16));await mkdir(dir,{recursive:true});
  const manifest=join(dir,'manifest.json');if(!await exists(manifest))await runCommand('go',['run','./cmd/wasmbench','corpus','--suite','calls','--out',manifest],{cwd:base,quiet:true,log:join(cache,'prepare.log')});
  inventory.push(...(await readCorpus(manifest)).map(w=>({...w,artifact:resolve(base,w.artifact)})));
 }
 let workloads=selectCorpora(inventory,selectors.map(s=>s.includes('/performance-')?s.split('/').slice(0,3).join('/'):s));
 const compatibility=options.mode==='bench'?workloads.filter(w=>w.id.startsWith('features/')):[];
 const expected=new Map((options.artifacts||[]).map(text=>{const split=text.lastIndexOf('=');if(split<1||!/^[a-f0-9]{64}$/.test(text.slice(split+1)))throw Error('Use --artifact workload=sha256');return [text.slice(0,split),text.slice(split+1)]}));
 const contracts=new Map((options.contracts||[]).map(text=>{const split=text.lastIndexOf('=');if(split<1||!/^[a-f0-9]{64}$/.test(text.slice(split+1)))throw Error('Use --contract workload=sha256');return [text.slice(0,split),text.slice(split+1)]}));
 if(options.mode==='bench'&&workloads.some(w=>w.id.startsWith('features/'))&&!options.dryRun){
  const selectedFamilies=[...new Set(compatibility.map(w=>w.id.split('/')[1]))].sort();
  const output=join(cache,'artifacts','feature-perf-'+policy.slice(0,16)+'-'+digest(Buffer.from(selectedFamilies.join(','))).slice(0,12));
  if(!await exists(join(output,'manifest.json')))await runCommand(process.execPath,[join(site,'scripts/feature-performance-suite.mjs'),output,'--family='+selectedFamilies.join(',')],{cwd:site,quiet:true,log:join(cache,'prepare.log')});
  const performance=[...await readCorpus(join(output,'manifest.json')),...await readCorpus(join(output,'compile-probes.json')),...await readCorpus(join(output,'lifecycle-probes.json'))];
  const families=new Set(workloads.filter(w=>w.id.startsWith('features/')).map(w=>w.id.split('/')[1]));
  workloads=[...workloads.filter(w=>!w.id.startsWith('features/')),...performance.filter(w=>families.has(w.id.split('/')[1])&&selectors.some(s=>s==='features'||w.id===s||w.id.startsWith(s.replace(/\/$/,'')+'/')||s===w.id.split('/').slice(0,3).join('/')))];
 }
 if(compatibility.length&&!options.dryRun)workloads=[...compatibility.map(w=>({...w,cliCompatibility:true})),...workloads];
 if(!workloads.length)throw Error('No selected performance workload is available');
 for(const w of workloads){
  if(w.artifact)w.artifactName||=basename(w.artifact);
  if(!options.dryRun&&digest(await readFile(w.artifact))!==w.sha256)throw Error('Corpus artifact differs from manifest: '+w.id);
  if(expected.has(w.id)&&expected.get(w.id)!==w.sha256)throw Error('Reproduction artifact differs: '+w.id+'. Use the corpus checkout that contains '+expected.get(w.id));
  if(contracts.has(w.id)&&contracts.get(w.id)!==workloadContract(w))throw Error('Reproduction contract differs: '+w.id);
 }
 for(const id of [...expected.keys(),...contracts.keys()])if(!workloads.some(w=>w.id===id))throw Error('Pinned reproduction workload not selected: '+id);
 if(options.dryRun)return {schema:1,engines:selected,workloads:workloads.map(w=>({id:w.id,sha256:w.sha256})),sampling:options.samples||samplePolicy,mode:options.mode};
 const sourceOverrides=new Map((options.sources||[]).map(text=>{const at=text.indexOf('=');if(at<1)throw Error('Use --source engine=path');return [resolveEngine(text.slice(0,at)).id,text.slice(at+1)]}));
 for(const id of sourceOverrides.keys())if(!selected.some(e=>e.id===id))throw Error('Local source engine is not selected: '+id);
 const identities=[];
 const stamp=new Date().toISOString();
 for(const engine of selected){
  emit({event:'preparing',engine:engine.id});
  const source=sourceOverrides.has(engine.id)?await snapshotSource(sourceOverrides.get(engine.id),cache):await checkoutSource(engine,cache,{offline:options.offline});
  if(options.sourceDigest&&source.digest!==options.sourceDigest)throw Error('Local source snapshot differs from the requested reproduction digest');
  identities.push({...engine,source});
 }
 let powerState='unknown';if(platform()==='darwin')try{powerState=execFileSync('pmset',['-g','custom'],{encoding:'utf8'}).split('\n').filter(line=>/Battery Power|AC Power|lowpowermode/.test(line)).join(';').trim()}catch{}
 const host={powerState,os:platform(),arch:arch()==='x64'?'amd64':arch(),cpu:cpus()[0].model,cores:cpus().length,kernel:execFileSync('uname',['-srv'],{encoding:'utf8'}).trim(),memoryBytes:totalmem()},cpu=measurementCPU();
 const collection=latencyCollection({suite:'wago',validationProfile:'all',launches:1,workers:1,samples:options.samples||5,warmup:0,operations:1,timeout:options.timeout||'5m',includeFeatures:false,supportsSteadyOperations:true,adaptiveSampling:options.samples?null:samplePolicy,scenarioSamples:options.samples?Object.fromEntries(['compile','instantiate','first-call','steady'].map(p=>[p,Math.min(options.samples,p==='compile'||p==='instantiate'?10:25)])):{'*':5}});
 const toolchains=['go','rustc','cc'].map(tool=>{try{return execFileSync(tool,[tool==='go'?'version':'--version'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\n')[0]}catch{return tool+':absent'}});
 const jobs=[];
 for(const identity of identities){
  const buildKey=digest(Buffer.from(JSON.stringify([identity.engine,identity.source.digest,policy,toolchains,platform(),arch(),process.env.RUSTFLAGS||'',process.env.CGO_CFLAGS||'']))),directory=join(cache,'tools',identity.engine+'-'+buildKey),receipt=join(directory,identity.family+'-build.json');
  jobs.push({...identity,buildKey,directory,receipt});
 }
 return {schema:1,created:stamp,host,cpu,cache,base,policy,mode:options.mode,offline:!!options.offline,rerun:!!options.rerun,timeout:options.timeout,timeoutMs:options.timeoutMs,collection,engines:jobs,workloads,jobs:jobs.flatMap(engine=>workloads.map(workload=>{const key=digest(Buffer.from(engine.id+'\0'+workload.id)),cacheKey=digest(Buffer.from(JSON.stringify([engine.buildKey,workload.sha256,workloadContract(workload),!!workload.cliCompatibility,collection,host,cpu])));return {key,cacheKey,engine:engine.id,workload:workload.id,requires:!workload.cliCompatibility&&workload.id.startsWith('features/')?compatibility.filter(w=>w.id.split('/')[1]===workload.id.split('/')[1]).map(w=>digest(Buffer.from(engine.id+'\0'+w.id))):[]}}))};
}
async function build(plan,engine){
 if(plan.policy!==await policyHash())throw Error('Collector changed since this run was created; start a new run. Existing samples are retained.');
 const directory=engine.directory,source=join(directory,'sources',engine.family);await mkdir(dirname(source),{recursive:true});
 if(!await exists(source))await cp(engine.source.path,source,{recursive:true,dereference:false,verbatimSymlinks:true});
 const pin={engine:engine.family,repository:engine.repository,revision:engine.source.revision,targetType:'main',targetWeek:plan.created,status:'planned',configurations:[engine.engine]};
 await writeFile(join(directory,'suite.json'),JSON.stringify([plan.workloads.find(w=>!w.id.startsWith('features/'))||plan.workloads[0]]));
 await writeFile(join(directory,'pins.json'),JSON.stringify({pins:[pin]}));
 const env={...process.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',WASMFYI_HISTORY_FAST:'1',...(engine.source.local&&engine.family==='wazero'?{WEEKLY_WAZERO_SOURCE:source}:{})};
 if(plan.offline&&!await exists(engine.receipt))throw Error('Runtime SDK is not cached; run once without --offline: '+engine.id);
 if(!await exists(engine.receipt))await runCommand(process.execPath,[join(site,'scripts/weekly-build.mjs'),directory,engine.family,plan.base],{cwd:site,env,quiet:true,log:join(directory,'prepare.log')});
 const receipt=await read(engine.receipt);const adapter=join(receipt.root,'bin','adapter-'+engine.engine);
 if(!await exists(receipt.controller)||!await exists(adapter))throw Error('Cached runtime build is incomplete; prune '+directory+' and resume');
 return {...receipt,adapterSha256:digest(await readFile(adapter)),controllerSha256:digest(await readFile(receipt.controller))};
}
export async function capture(plan,job,{skip=false}={}){
 if(plan.policy!==await policyHash())throw Error('Collector changed since this run was created; start a new run. Existing samples are retained.');
 const engine=plan.engines.find(e=>e.id===job.engine),workload=plan.workloads.find(w=>w.id===job.workload),receipt=await read(engine.receipt);
 if(digest(await readFile(workload.artifact))!==workload.sha256)throw Error('Frozen workload artifact changed: '+workload.id);
 const directory=join(plan.cache,'scratch',job.key+'-'+process.pid);await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'wago-suite.json'),JSON.stringify([workload]));
 const source={repository:engine.source.local?'local:'+engine.repository:engine.repository,revision:engine.source.local?engine.source.base:engine.source.revision,ref:engine.source.local?'local:'+engine.source.base+':'+engine.source.digest:engine.source.tag||'main@'+engine.source.revision,kind:engine.source.local?'current':engine.source.tag?'release':'snapshot',asOf:plan.created};
 const env={...process.env,...receipt.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',GOMAXPROCS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1',WASMBENCH_SOURCE_JSON:JSON.stringify(source),WASMBENCH_SINGLE_CORE:'1',WASMBENCH_RECORD_FAILURES:'1',WASMBENCH_CODE_SIZE_ONLY:'1'};
 const abort=new AbortController();for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>abort.abort());const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(plan.timeoutMs||300000)]);
 const collection=plan.mode==='test'||workload.cliCompatibility?{...plan.collection,samples:1,memory:false,code:false,adaptiveSampling:null,scenarioSamples:{'*':1},scenarios:featureScenarios('compatibility',workload)}:{...plan.collection,singleProcess:true};
 try{
  let result;
  if(skip){
   result=historyWorkloadFailure({workload,job:{engine:engine.engine,source},platform:plan.host,error:Error('Feature compatibility prerequisites did not all pass')}).capture;
   for(const row of result.results)row.latencyStatus='disabled';
   emit({event:'diagnostic',message:'Feature performance skipped: compatibility did not pass for '+workload.id});
  }else try{result=await collectLatencies({directory,workloads:[workload],engines:[engine.engine],collection,run:async(...args)=>{const launch=measurementLaunch(receipt.controller,args,{cpu:plan.cpu??2});return runCommand(launch.program,launch.args,{cwd:receipt.root,env,signal,quiet:true,log:join(directory,'producer.log')})}})}
  catch(error){if(abort.signal.aborted)throw error;const failure=historyWorkloadFailure({workload,job:{engine:engine.engine,source},error,signal,platform:plan.host});result=failure.capture;emit({event:'diagnostic',message:failure.note.reason})}
  try{const notes=await read(join(directory,'failures.json'));for(const note of notes.slice(0,4))emit({event:'diagnostic',message:note.phase+': '+String(note.reason).slice(0,2048)})}catch(error){if(error.code!=='ENOENT')throw error}
  result.source=source;
  if(engine.source.local)for(const row of result.results)row.version+='-local.'+engine.source.digest.slice(0,12);
  emit({event:'capture',key:job.key,cacheKey:job.cacheKey,capture:result});
 }finally{await rm(directory,{recursive:true,force:true})}
}
if(process.argv[1]&&await realpath(process.argv[1])===await realpath(fileURLToPath(import.meta.url))){
 try{
  const [action,path,key]=process.argv.slice(2);
  if(action==='catalogue')emit({event:'result',engines,corpora:[...await catalogue(),...callIds.map(id=>({id}))].map(w=>({id:w.id,sha256:w.sha256,feature:w.id.startsWith('features/')}))});
  else if(action==='prepare')emit({event:'result',plan:await prepare(await read(path))});
  else if(action==='build'){const plan=await read(path);const results=[];for(const engine of plan.engines){emit({event:'preparing',engine:engine.id});results.push({id:engine.id,...await build(plan,engine)})}emit({event:'result',builds:results})}
  else if(action==='capture'||action==='skip'){const plan=await read(path);await capture(plan,plan.jobs.find(j=>j.key===key),{skip:action==='skip'})}
  else throw Error('Unknown worker action');
 }catch(error){emit({event:'error',message:error.message});process.exitCode=1}
}
