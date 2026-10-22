// Prebuild one exact source snapshot; collection remains owned by the coordinator.
import {readFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runCommand} from './lib/benchmark-process.mjs';
import {readCache,atomicJSON} from './lib/benchmark-plan.mjs';
import {historyBuildDirectory} from './lib/history-build-cache.mjs';
import {prepareHistoryPin} from './lib/prepare-history-pin.mjs';
const [rootArg,engine,configuration,profile]=process.argv.slice(2),root=resolve(rootArg);
const plan=JSON.parse(await readFile(join(root,'source-plan.json')));
const template=JSON.parse(await readFile(join(root,'collection-template.json')));
const requestedWeek=process.env.WASMFYI_HISTORY_WEEK;
const pin=prepareHistoryPin(plan.pins,{engine,configuration,week:requestedWeek});
if(!pin)throw Error('No planned snapshot for '+configuration);
const baseDirectory=await historyBuildDirectory(root,pin,configuration);
const directory=profile?baseDirectory+'-'+profile:baseDirectory;
await mkdir(directory,{recursive:true});
const env={...process.env,...template.env,PATH:[process.env.PATH,template.env?.PATH].filter(Boolean).join(':'),GOWORK:'off',GOFLAGS:'-buildvcs=false'};
if(engine==='wamr'&&['fast','classic'].includes(profile))env.WASMFYI_WAMR_INTERPRETER_PROFILE=profile;
if(engine==='wamr'&&profile==='features')env.WASMFYI_WAMR_FEATURE_PROPOSALS='1';
if(engine==='wamr'&&profile&&!['fast','classic','features'].includes(profile))throw Error('Unknown WAMR SDK profile '+profile);
const run=(program,args)=>runCommand(program,args,{cwd:process.cwd(),env,log:join(directory,'prepare.log')});
const source=join(directory,'sources',engine);await mkdir(join(directory,'sources'),{recursive:true});
if(!await stat(join(source,'.git')).catch(()=>null)){
 const cachedSource=join(baseDirectory,'sources',engine);
 if(profile&&await stat(join(cachedSource,'.git')).catch(()=>null)){
  await run('git',['clone','--shared','--no-checkout',cachedSource,source]);
  await run('git',['-C',source,'remote','set-url','origin','https://github.com/'+pin.repository+'.git']);
 }else{
  await mkdir(source,{recursive:true});await run('git',['init',source]);
  await run('git',['-C',source,'remote','add','origin','https://github.com/'+pin.repository+'.git']);
 }
}
if(engine==='jsc'){
 await run('git',['-C',source,'sparse-checkout','init','--cone']);
 await run('git',['-C',source,'sparse-checkout','set','Configurations','Source','Tools/Scripts','Tools/TestWebKitAPI','Tools/clangd','WebKitLibraries']);
}
const currentRevision=await run('git',['-C',source,'rev-parse','HEAD']).then(result=>result.output.trim(),()=>null);
if(currentRevision!==pin.revision){
 await run('git',['-C',source,'fetch','--depth','1','origin',pin.revision]);
}
await run('git',['-C',source,'checkout','--detach',pin.revision]);
if((await run('git',['-C',source,'rev-parse','HEAD'])).output.trim()!==pin.revision)throw Error('Prepared source differs from its exact pin');
const inventory=new Map(template.workloads.map(w=>[w.id,w.sha256]));
const suite=(await readCache(template.corpusRoot)).filter(w=>inventory.get(w.id)===w.sha256);
if(suite.length!==inventory.size)throw Error('Frozen suite is incomplete');
await atomicJSON(join(directory,'suite.json'),suite);await atomicJSON(join(directory,'pins.json'),{pins:[{...pin,configurations:[configuration]}]});
const frozenHarness=await stat(join(root,'frozen-harness')).then(()=>join(root,'frozen-harness'),async()=>{
 const legacy=join(root,'frozen-base');
 if(!await stat(legacy).catch(()=>null))throw Error('Frozen campaign harness is missing');
 return legacy;
});
await run(process.execPath,['scripts/weekly-build.mjs',directory,engine,frozenHarness]);
const receipt=JSON.parse(await readFile(join(directory,engine+'-build.json')));
const jobSource={repository:pin.repository,revision:pin.revision,ref:pin.tag||'main@'+pin.revision.slice(0,8),asOf:pin.targetWeek,kind:pin.targetType==='main'?'snapshot':'release',...(pin.dateBasis?{dateBasis:pin.dateBasis}:{})};
const job={id:'prepared-'+configuration+(profile?'-'+profile:'')+'-'+pin.revision.slice(0,12),engine:configuration,harness:receipt.root,controller:receipt.controller,env:receipt.env||{},historical:true,source:jobSource,...(profile?{featureProfile:profile}:{}),...(engine==='jsc'?{backend:'OMG (forced tier-up)'}:{})};
await atomicJSON(join(directory,'plan.json'),{...template,captureDirectory:join(root,'captures'),jobs:[job]});
console.log(JSON.stringify({engine,configuration,revision:pin.revision,directory,status:'prepared'}));
