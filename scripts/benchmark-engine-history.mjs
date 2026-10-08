// One complete engine family, newest source target first, using the frozen corpus.
import {readFile,writeFile,mkdir,stat,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {copyHistoricalHarness,buildHistoricalBinding,restoreHistoricalHarnessSources} from './lib/historical-binding.mjs';
import {command} from './lib/wasmbench.mjs';
import {readCache,atomicJSON} from './lib/benchmark-plan.mjs';
import {historyBuildDirectory} from './lib/history-build-cache.mjs';
import {pruneRustIntermediates} from './lib/prune-build-cache.mjs';
import {wasmedgeJITUnavailable} from './lib/wasmedge-sdk.mjs';
import {wamrArchitectureUnavailable} from './lib/wamr-sdk.mjs';
const [rootArg,baseArg,engine]=process.argv.slice(2),root=resolve(rootArg),base=resolve(baseArg);
if(!engine)throw Error('Engine family required');
const selectedRefs=new Set(process.argv.slice(5));
const plan=JSON.parse(await readFile(join(root,'source-plan.json'))),template=JSON.parse(await readFile(join(root,'collection-template.json')));
for(const ref of selectedRefs)if(!plan.pins.some(p=>p.engine===engine&&p.status==='planned'&&(p.tag||p.revision)===ref))throw Error('Unknown supplemental source target '+ref);
if(template.collection.samples<1)throw Error('Performance history requires at least one sample');
const env={...process.env,...template.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',CARGO_BUILD_JOBS:'1',GOMAXPROCS:'1'};
const statusPath=join(root,engine+(selectedRefs.size?'-supplement':'')+'-history-status.json');
const status=await readFile(statusPath,'utf8').then(JSON.parse,()=>({started:new Date().toISOString(),completed:[],errors:[]}));
const inventory=new Map(template.workloads.map(w=>[w.id,w.sha256]));
const suite=(await readCache(template.corpusRoot)).filter(w=>inventory.has(w.id));
if(suite.length!==inventory.size)throw Error('Frozen corpus incomplete');
async function run(program,args,options={}) {
 return new Promise((yes,no)=>{const fd=openSync(join(root,engine+'-history.log'),'a');const child=spawn(program,args,{env,cwd:process.cwd(),stdio:['ignore',fd,fd],...options});closeSync(fd);child.on('error',no);child.on('exit',code=>code===0?yes():no(Error(program+' exited '+code)));});
}
const controller=join(root,'controller-year');
if(!await stat(controller).catch(()=>null))await run('go',['build','-o',controller,'./cmd/wasmbench'],{cwd:base});
for(const pin of plan.pins.filter(p=>p.engine===engine&&p.status==='planned'&&(!selectedRefs.size||selectedRefs.has(p.tag||p.revision))).sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek))) {
 if(Date.parse(pin.targetWeek)<Date.parse(plan.cutoff)||Date.parse(pin.targetWeek)>Date.parse(plan.anchor))throw Error('Pin outside year');
 for(const configuration of pin.configurations) {
  const pinKey=[configuration,pin.targetType,pin.tag||pin.revision,pin.targetWeek].join('|');
  if(status.completed.some(x=>x.pinKey===pinKey))continue;
  const label=[configuration,pin.tag||pin.revision,pin.targetType,pin.targetWeek].join('-').replace(/[^a-zA-Z0-9.-]/g,'_');
  const directory=join(root,'engine-builds',label);await mkdir(directory,{recursive:true});
  // Cranelift and Winch use the same SDK executable, selected by --winch.
  // Keep separate result jobs while sharing the expensive source build.
  const buildDirectory=await historyBuildDirectory(root,pin,configuration);
  await mkdir(buildDirectory,{recursive:true});
  status.current={engine,configuration,ref:pin.tag||pin.revision,asOf:pin.targetWeek};await atomicJSON(statusPath,status);
  console.log(JSON.stringify({event:'build',...status.current}));
  try {
   let harness=join(buildDirectory,'harness'),buildEnv={...env},revision=pin.revision,unavailable=null;
   if(pin.targetType==='main'||pin.dateBasis==='git-tag-commit') {
    const source=join(buildDirectory,'sources',engine);await mkdir(source,{recursive:true});
    if(!await stat(join(source,'.git')).catch(()=>null)){await run('git',['init',source]);await run('git',['-C',source,'remote','add','origin','https://github.com/'+pin.repository+'.git']);}
    await run('git',['-C',source,'fetch','--depth','1','origin',pin.revision]);
    await run('git',['-C',source,'checkout','--detach',pin.revision]);
    if(engine==='wamr')unavailable=await wamrArchitectureUnavailable(source,configuration);
    if(engine==='wasmedge')unavailable=await wasmedgeJITUnavailable(source,configuration);
    await atomicJSON(join(buildDirectory,'pins.json'),{pins:[{...pin,configurations:[configuration]}]});
    await atomicJSON(join(buildDirectory,'suite.json'),suite);
    if(unavailable){harness=base;await atomicJSON(join(buildDirectory,'unsupported-platform.json'),unavailable);}
    else {
    const receiptPath=join(buildDirectory,engine+'-build.json');
    if(!await stat(receiptPath).catch(()=>null))await run(process.execPath,['scripts/weekly-build.mjs',buildDirectory,engine,base]);
    const receipt=JSON.parse(await readFile(receiptPath));harness=receipt.root;buildEnv={...env,...receipt.env};
    }
   } else {
    if(!await stat(harness).catch(()=>null))await copyHistoricalHarness(base,harness);
    const bindingPath=join(buildDirectory,'binding.json');let binding;
    if(await stat(bindingPath).catch(()=>null)){binding=JSON.parse(await readFile(bindingPath));Object.assign(buildEnv,binding.environment);}
    else {
     await restoreHistoricalHarnessSources(base,harness);
     const invoke=(...args)=>{
      if(args[0]==='build'&&configuration.startsWith('wasmtime')) {
       command('cargo',['build','--release','--locked','--no-default-features','--manifest-path',join(harness,'adapters/wasmtime/Cargo.toml'),'--bin','adapter-wasmtime'],{cwd:harness,env:buildEnv,stdio:'inherit'});
      } else command(controller,args,{cwd:harness,env:buildEnv,stdio:'inherit'});
     };
     try {binding=await buildHistoricalBinding({root:harness,pin,configuration,invoke,env:buildEnv});}
     catch(error){if(!['UNSUPPORTED_PLATFORM','UNSUPPORTED_BACKEND'].includes(error.code))throw error;unavailable=error.proof||{reason:String(error)};await atomicJSON(join(buildDirectory,'unsupported-platform.json'),unavailable);binding={source:{revision:unavailable.revision||pin.revision||pin.tag},unsupportedPlatform:unavailable};}
     binding.environment=Object.fromEntries(Object.entries(buildEnv).filter(([k])=>k.startsWith('WASMBENCH_')));await atomicJSON(bindingPath,binding);
    }
    unavailable ||=binding.unsupportedPlatform||null;
    revision=pin.revision||binding.source.revision||binding.source.archiveSha256||pin.tag;
   }
   if(!unavailable)await pruneRustIntermediates(harness);
   const job={id:'history-'+template.collection.samples+'-'+label,engine:configuration,harness,controller,env:Object.fromEntries(Object.entries(buildEnv).filter(([k])=>k.startsWith('WASMBENCH_'))),historical:true,source:{repository:pin.repository,revision,ref:pin.tag||'main@'+revision.slice(0,8),asOf:pin.targetWeek,kind:pin.targetType==='main'?'snapshot':'release',...(pin.dateBasis?{dateBasis:pin.dateBasis}:{})}};
   if(unavailable){job.unavailableReason=unavailable.reason;job.backend=configuration==='wamr-fast-jit'?'fast-jit':configuration;}
   await atomicJSON(join(directory,'plan.json'),{...template,captureDirectory:join(root,'captures'),jobs:[job]});
   await run(process.execPath,['scripts/benchmark-history-worker.mjs',directory]);
   const result=JSON.parse(await readFile(join(directory,'status.json')));
   if(result.status!=='completed'||result.completed!==suite.length)throw Error('Incomplete collection '+result.status+'; '+result.errors.length+' errors');
   status.completed.push({pinKey,engine,configuration,asOf:pin.targetWeek,ref:job.source.ref,captures:result.completed});
  }catch(error){status.errors.push({pinKey,...status.current,error:String(error)});console.error(error);}
  status.updated=new Date().toISOString();await atomicJSON(statusPath,status);
 }
}
status.current=null;status.status=status.errors.length?'needs-repair':'completed';await atomicJSON(statusPath,status);
