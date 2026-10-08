// Resumable latest-pinned feature compatibility and performance collection.
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {join,basename,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {collectLatencies} from './lib/latency-capture.mjs';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
import {digest} from './lib/wasmbench.mjs';
const root=resolve(process.argv[2]),main=resolve(process.argv[3]),old=join(main,'..','history-ytd-20261008');
const source=JSON.parse(await readFile(join(main,'source-plan.json')));
const state={status:'waiting-for-current-work',updated:'',current:null,completed:[],errors:[]};
await mkdir(root,{recursive:true});
async function save(){state.updated=new Date().toISOString();await writeFile(join(root,'status.json'),JSON.stringify(state,null,2)+'\n')}
async function currentWorkActive(){
 const s=await readFile(join(main,'coordinator-status.json'),'utf8').then(JSON.parse,()=>null);
 if(!s||s.status==='running')return true;
 // A free measurement lock alone is insufficient: builders can be between stages.
 const output=await new Promise((ok,fail)=>{const p=spawn('ps',['-eo','pid,args']);let text='';p.stdout.on('data',d=>text+=d);p.on('error',fail);p.on('exit',()=>ok(text))});
 return output.split('\n').some(line=>!line.trim().startsWith(String(process.pid)+' ')&&line.includes(main)&&/benchmark-(round-robin|engine-history|go-history|libwasm-history|history-worker)|repair-(wasmer-native-code|wamr-code|capture-code)/.test(line));
}
await save();while(await currentWorkActive())await delay(15000);
const plans=[];
async function scan(path,depth=0){if(depth>5)return;for(const entry of await readdir(path,{withFileTypes:true}).catch(()=>[])){if(entry.name==='plan.json'){try{plans.push(JSON.parse(await readFile(join(path,entry.name))))}catch{}}else if(entry.isDirectory()&&!['scratch','harness','target','repositories','sdk-builds','repairs','tool-cache','node_modules','captures','data','hub','remote'].includes(entry.name))await scan(join(path,entry.name),depth+1)}}
await scan(main);await scan(old);
const compatibility=JSON.parse(await readFile(join(root,'inputs','compatibility.json')));
const performance=JSON.parse(await readFile(join(root,'inputs','performance.json')));
const compile=JSON.parse(await readFile(join(root,'inputs','compile.json')));
const lifecycle=JSON.parse(await readFile(join(root,'inputs','lifecycle.json')));
for(const w of [...compatibility,...performance,...compile,...lifecycle]){w.artifact=join(root,'inputs',w.artifact);if(digest(await readFile(w.artifact))!==w.sha256)throw Error('Artifact mismatch: '+w.id)}
for(const family of source.order){
 const pin=source.pins.find(p=>p.engine===family);if(!pin)continue;
 for(const engine of pin.configurations){
  const match=plans.flatMap(p=>(p.jobs||[]).map(job=>({p,job}))).find(({job})=>job.engine===engine&&(job.source?.revision===pin.revision||job.source?.ref===pin.tag||job.source?.ref===pin.targetRelease));
  if(!match){state.errors.push({engine,error:'No completed pinned SDK job plan available'});await save();continue}
  const {p,job}=match,controller=job.controller||p.controller,harness=job.harness||p.harness;
  const env={...process.env,...p.env,...job.env,GOMAXPROCS:'1',CARGO_BUILD_JOBS:'1',CMAKE_BUILD_PARALLEL_LEVEL:'1',MAKEFLAGS:'-j1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1',WASMBENCH_SINGLE_CORE:'1',WASMBENCH_RECORD_FAILURES:'1',WASMBENCH_CODE_SIZE_ONLY:'1',WASMBENCH_SOURCE_JSON:JSON.stringify(job.source)};
  const run=(...args)=>new Promise((ok,fail)=>{const linux=process.platform==='linux';const child=spawn(linux?'taskset':'taskpolicy',linux?['-c',String(p.cpu??2),controller,...args]:['-a','-t','0','-l','0',controller,...args],{cwd:harness,env,stdio:['ignore','inherit','inherit']});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error('Controller exited '+code)))});
  const dir=join(root,engine);await mkdir(dir,{recursive:true});state.status='running';state.current={engine,phase:'compatibility'};await save();
  const done=join(dir,'compatibility.json');
  if(!await stat(done).catch(()=>null)){
   const release=await acquireMeasurementLock(join(main,'measurement-lock'));
   try{
    const suite=join(dir,'compatibility-suite.json');await writeFile(suite,JSON.stringify(compatibility));
    const output=join(dir,'compatibility-raw');let error=null;
    try{await run('check','--archive-tools=false','--suite',suite,'--runtimes',engine,'--scenarios','compile,instantiate,first-call,steady','--validation-profile','all','--launches','1','--samples','1','--operations','1','--warmup','0','--timeout','30s','--out',output)}catch(e){error=String(e)}
    await run('verify','--run',output);
    const trials=[];for(const f of await readdir(join(output,'trials')))if(f.endsWith('.json'))trials.push(JSON.parse(await readFile(join(output,'trials',f))));
    await writeFile(done,JSON.stringify({engine,source:job.source,error,trials},null,2)+'\n');
   }catch(e){state.errors.push({engine,phase:'compatibility',error:String(e)})}finally{await release()}
  }
  for(const [kind,workloads] of [['performance',performance],['compile',compile],['lifecycle',lifecycle]])for(const w of workloads){
   const file=join(dir,kind+'-'+digest(Buffer.from(w.id)).slice(0,16)+'.json');
   if(await stat(file).catch(()=>null))continue;
   state.current={engine,phase:kind,workload:w.id};await save();
   const release=await acquireMeasurementLock(join(main,'measurement-lock'));
   try{
    const scratch=join(dir,'scratch');await mkdir(scratch,{recursive:true});await writeFile(join(scratch,'wago-suite.json'),JSON.stringify([w]));
    process.env.WASMBENCH_SOURCE_JSON=env.WASMBENCH_SOURCE_JSON;
    const scenarios=kind==='compile'?(w.provenance?.scope==='compile-and-instantiate'?'compile,instantiate':'compile'):'compile,instantiate,first-call,steady';
    const capture=await collectLatencies({directory:scratch,workloads:[w],engines:[engine],collection:{scenarios,timeout:'30s',launches:3,samples:5,operations:1,warmup:7,memory:true,code:true},run});
    await writeFile(file,JSON.stringify(capture,null,2)+'\n');
   }catch(e){state.errors.push({engine,phase:kind,workload:w.id,error:String(e)})}finally{await release()}
  }
  state.completed.push(engine);await save();
 }
}
state.current=null;state.status=state.errors.length?'completed-with-errors':'completed';await save();
