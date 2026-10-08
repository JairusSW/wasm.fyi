// Retry a release in isolation without editing a live coordinator's status.
import {readFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildHistoricalBinding,copyHistoricalHarness,restoreHistoricalHarnessSources,assertHistoricalRuntime} from './lib/historical-binding.mjs';
import {atomicJSON,readCache} from './lib/benchmark-plan.mjs';
import {historyBuildDirectory} from './lib/history-build-cache.mjs';
import {command} from './lib/wasmbench.mjs';
const [rootArg,engine,tag,mode]=process.argv.slice(2),root=resolve(rootArg);
if(mode&&mode!=='--prepare-only')throw Error('Unknown release repair mode');
const plan=JSON.parse(await readFile(join(root,'source-plan.json')));
const template=JSON.parse(await readFile(join(root,'collection-template.json')));
const pin=plan.pins.find(p=>p.engine===engine&&p.tag===tag&&p.targetType==='release'&&p.status==='planned');
if(!pin||template.collection.samples<12)throw Error('A planned release and twelve samples are required');
if(Date.parse(pin.targetWeek)<Date.parse(plan.cutoff)||Date.parse(pin.targetWeek)>Date.parse(plan.anchor))throw Error('Release outside authorized window');
const directory=join(root,'repairs',[engine,tag].join('-').replace(/[^a-zA-Z0-9.-]/g,'_'));
await mkdir(directory,{recursive:true});
const controller=join(root,'controller-year'),base=join(root,'frozen-harness'),jobs=[];
const inventory=new Map(template.workloads.map(w=>[w.id,w.sha256]));
const suite=(await readCache(template.corpusRoot)).filter(w=>inventory.get(w.id)===w.sha256);
if(suite.length!==inventory.size)throw Error('Frozen corpus is incomplete');
await atomicJSON(join(directory,'suite.json'),suite);
const built=new Map();
for(const configuration of pin.configurations){
 const buildDirectory=await historyBuildDirectory(root,pin,configuration),harness=join(buildDirectory,'harness');
 await mkdir(buildDirectory,{recursive:true});
 const env={...process.env,...template.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',CARGO_BUILD_JOBS:'2'};
 const invoke=(...args)=>configuration.startsWith('wasmtime')&&args[0]==='build'
  ?command('cargo',['build','--release','--locked','--no-default-features','--manifest-path',join(harness,'adapters/wasmtime/Cargo.toml'),'--bin','adapter-wasmtime'],{cwd:harness,env,stdio:'inherit'})
  :command(controller,args,{cwd:harness,env,stdio:'inherit'});
 let binding;
 if(built.has(buildDirectory)){
  binding={...built.get(buildDirectory),configuration};Object.assign(env,binding.environment);
 }else{
  if(!await stat(harness).catch(()=>null))await copyHistoricalHarness(base,harness);
  await restoreHistoricalHarnessSources(base,harness);
  binding=await buildHistoricalBinding({root:harness,pin,configuration,invoke,env});
 }
 binding.environment=Object.fromEntries(Object.entries(env).filter(([key])=>key.startsWith('WASMBENCH_')));
 built.set(buildDirectory,binding);
 const preflight=join(directory,configuration+'-preflight-'+randomUUID()+'.json');
 command(controller,['plan','--suite',join(directory,'suite.json'),'--runtimes',configuration,'--profile','timing','--out',preflight],{cwd:harness,env,stdio:'inherit'});
 const runtime=JSON.parse(await readFile(preflight)).runtime_configurations[0];
 runtime.description=JSON.parse(command(runtime.command[0],runtime.command.slice(1),{cwd:harness,env,timeout:30000,input:'{"version":1,"id":1,"method":"describe"}\n'}).toString().trim()).description;
 assertHistoricalRuntime(runtime,binding);
 await atomicJSON(join(directory,configuration+'-description.json'),runtime);
 if(pin.configurations.length===1)await atomicJSON(join(directory,engine+'-build.json'),{root:harness,runtime,env:binding.environment,binding,scope:'Exact release SDK preparation; performance collection is separate'});
 await atomicJSON(join(directory,configuration+'-binding.json'),binding);
 const label=[configuration,tag,pin.targetType,pin.targetWeek].join('-').replace(/[^a-zA-Z0-9.-]/g,'_');
 jobs.push({id:'history-'+template.collection.samples+'-'+label,engine:configuration,harness,controller,env:binding.environment,historical:true,source:{repository:pin.repository,revision:binding.source.revision||binding.source.archiveSha256||tag,ref:tag,asOf:pin.targetWeek,kind:'release'}});
}
await atomicJSON(join(directory,'plan.json'),{...template,captureDirectory:join(root,'captures'),jobs});
if(mode==='--prepare-only'){console.log(JSON.stringify({engine,tag,directory,status:'prepared'}));process.exit(0);}
command(process.execPath,['scripts/benchmark-history-worker.mjs',directory],{cwd:process.cwd(),stdio:'inherit',timeout:24*60*60*1000});
const status=JSON.parse(await readFile(join(directory,'status.json')));
if(status.status!=='completed'||status.errors.length)throw Error('Release retry did not complete');
await atomicJSON(join(directory,'completion.json'),{engine,tag,configurations:pin.configurations,captures:status.completed,scope:'Isolated retry; coordinator status reconciliation remains required',completed:new Date().toISOString()});
