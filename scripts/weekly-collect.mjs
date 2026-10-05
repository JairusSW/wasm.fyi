import {readFile, stat, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {config, digest, site} from './lib/wasmbench.mjs';
import {readCache, portableWorkloads, verifyWorkloads, planIdentity, atomicJSON} from './lib/benchmark-plan.mjs';
import {corpusGroups} from './lib/corpus-collection.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {validateV8Description} from './lib/v8-preflight.mjs';
const [directoryArg,engine]=process.argv.slice(2), directory=resolve(directoryArg);
const receipt=JSON.parse(await readFile(join(directory,engine+'-build.json')));
const env={...process.env,...receipt.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',NODE_OPTIONS:''};
const runtime=receipt.runtime;
if(digest(await readFile(receipt.controller))!==receipt.controllerSha256)throw Error('Frozen controller binary changed');
if(digest(await readFile(join(receipt.root,'adapters/wasmtime/target/release/wasm-analyze')))!==receipt.analyzerSha256)throw Error('Frozen analyzer binary changed');
const described=JSON.parse(execFileSync(runtime.command[0],runtime.command.slice(1),{cwd:receipt.root,env,input:JSON.stringify({version:1,id:1,method:'describe'})+'\n',timeout:30000}).toString()).description;
if(!described)throw Error('Weekly adapter has no description');
const version=described.runtime_version;
const pin=receipt.pin;
const pinSet=JSON.parse(await readFile(join(directory,'pins.json')));
const calendar=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:pinSet.zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(pinSet.cutoff)).map(p=>[p.type,p.value]));
const snapshotId=`weekly-${calendar.year}${calendar.month}${calendar.day}`;
if(engine==='v8')validateV8Description(described,{version:receipt.provenance.versions.node,v8:receipt.provenance.versions.v8},'optimizing-only');
if(engine==='wago' && !version.startsWith(pin.revision+'/source-'))throw Error('Wago source revision differs');
if(engine==='wazero' && version!==receipt.provenance.module.Version.replace(/^v/,''))throw Error('Wazero source module differs');
if(engine==='wasmtime' && (version!==pin.revision || described.backend!=='cranelift'))throw Error('Wasmtime source revision or compiler differs');
if(engine==='v8' && (described.backend!=='optimizing-only' || version!==receipt.provenance.versions.v8 || !described.effective_configuration?.compiler_mode_probe))throw Error('Node/V8 source build or optimizing tier differs');
if(engine==='wasmer' && described.backend!=='singlepass-jit')throw Error('Wasmer compiler differs');
if(engine==='wasmer' && receipt.provenance.sdkVersion && version!==receipt.provenance.sdkVersion)throw Error('Wasmer SDK version differs from its pinned source');
if(engine==='wavm' && (!version.endsWith(pin.revision.slice(0,7)) || described.backend!=='llvm-jit'))throw Error('WAVM source or compiler differs');
if(process.argv.includes('--qualify-only')){console.log(engine,'qualified',version,described.backend);process.exit(0);}
const workloads=(await readCache(site)).filter(w=>!w.id.startsWith('features/'));await verifyWorkloads(workloads);
const settings=await config(), name=process.platform==='darwin'?'local':'hub';
const session=join(directory,'sessions',engine);await mkdir(session,{recursive:true});
const plan={schema:1,id:snapshotId+'-'+engine,created:new Date().toISOString(),engines:pin.configurations,machines:[{name,workers:'25%'}],sourcePin:pin,
 collection:{...settings.collection,runtimes:pin.configurations,includeFeatures:false,workers:1},live:false,deploy:false,
 wagoRevision:engine==='wago'?pin.revision:null,sourceReceiptSha256:digest(await readFile(join(directory,engine+'-build.json'))),
 jobs:corpusGroups(portableWorkloads(site,workloads)).map((workloads,i)=>({id:'corpus-'+String(i+1).padStart(4,'0'),workloads}))};
plan.identity=planIdentity(plan);
const previous=await readFile(join(session,'plan.json'),'utf8').then(JSON.parse,()=>null);
if(previous && previous.identity!==plan.identity)throw Error('Weekly session changed; use a new session');
if(!previous)await atomicJSON(join(session,'plan.json'),plan);
await atomicJSON(join(session,'host.json'),{name,workers:'25%',harness:receipt.root,controller:receipt.controller});
await atomicJSON(join(session,'qualification.json'),{pin,description:described,qualifiedAt:new Date().toISOString(),binarySha256:digest(await readFile(runtime.command[0]))});
console.log(`${engine} ${pin.revision.slice(0,12)} · ${name} · ${workloads.length} workloads in ${plan.jobs.length} corpora`);
const abort=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>abort.abort());
const result=await runCommand(process.execPath,[join(site,'scripts/benchmark-host.mjs'),session],{cwd:site,env,signal:abort.signal,check:false,log:join(session,'supervisor.log'),onLine:line=>{
 let event;try{event=JSON.parse(line);}catch{return;}if(!event.benchmarkEvent)return;
 if(event.status==='completed' && event.result){
 console.log(`${engine} ${event.corpus}: ${event.result.verdict} · ${event.result.workloads.join(', ')}`);
 const timing=scenario=>{const row=event.result.summaries.findLast(r=>r.scenario===scenario&&r.median_ns_per_operation!=null);return row?`${(row.median_ns_per_operation/1000).toFixed(3)} µs`:'unavailable';};
 const rss=event.result.memory.filter(r=>r.metric==='process.rss'&&r.median_bytes!=null);
 const code=event.result.code.find(r=>r.image_bytes!=null||r.size_bytes!=null);
 console.log(`  compile ${timing('compile')} · instantiate ${timing('instantiate')} · steady ${timing('steady')} · average RSS ${rss.length?(rss.reduce((sum,r)=>sum+r.median_bytes,0)/rss.length/1024**2).toFixed(1)+' MiB':'unavailable'} · code ${code?.image_bytes??code?.size_bytes??'unavailable'} B`);
} 
 else if(['host-ready','completed','completed-with-failures','incomplete','host-failed','interrupted'].includes(event.status))console.log(engine,event.status,event.remaining??'',event.workers??'');
}});
process.exitCode=result.code;
