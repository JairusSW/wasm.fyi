// Build exact source pins, then collect with the compact worker, one engine at a time.
import {readFile,writeFile,mkdir,stat,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {readCache} from './lib/benchmark-plan.mjs';
import {wagoArchitectureUnavailable} from './lib/source-compatibility.mjs';
import {copyHistoricalHarness} from './lib/historical-binding.mjs';
const [rootArg,baseArg,selectedEngine]=process.argv.slice(2),root=resolve(rootArg),base=resolve(baseArg);
const selectedRefs=new Set(process.argv.slice(5));
const sourcePlan=JSON.parse(await readFile(join(root,'source-plan.json'))),template=JSON.parse(await readFile(join(root,'collection-template.json')));
const env={...process.env,...template.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',GOMAXPROCS:'1',CARGO_BUILD_JOBS:'1'};
const log=await import('node:fs');
async function run(program,args,options={}){return new Promise((yes,no)=>{const fd=log.openSync(join(root,'build.log'),'a');const child=spawn(program,args,{env,cwd:base,stdio:['ignore',fd,fd],...options});log.closeSync(fd);child.on('error',no);child.on('exit',code=>code===0?yes():no(Error(program+' exited '+code)))})}
const frozen=join(root,'frozen-harness');if(!await stat(frozen).catch(()=>null)){await copyHistoricalHarness(base,frozen);await run('git',['init',frozen]);await run('git',['-C',frozen,'add','.']);await run('git',['-C',frozen,'-c','user.name=Benchmark collector','-c','user.email=collector@localhost','commit','-m','Frozen benchmark harness']);}
const progress=await readFile(join(root,'build-status.json'),'utf8').then(JSON.parse,()=>({started:new Date().toISOString(),completed:[],errors:[]}));
if(template.collection.samples<1)throw Error('Performance history requires at least one sample');
for(const engine of (selectedEngine?[selectedEngine]:['wago','wazero','wasm2go'])){
 if(!['wago','wazero','wasm2go'].includes(engine))throw Error('Unknown Go history engine '+engine);
 for(const pin of sourcePlan.pins.filter(p=>p.engine===engine&&p.status==='planned'&&(!selectedRefs.size||selectedRefs.has(p.tag||p.revision))).sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek))){
  if(Date.parse(pin.targetWeek)<Date.parse(sourcePlan.cutoff)||Date.parse(pin.targetWeek)>Date.parse(sourcePlan.anchor))continue;
  const pinKey=engine+'|'+pin.targetType+'|'+(pin.tag||pin.revision)+'|'+pin.targetWeek;
  if(progress.completed.some(p=>p.pinKey===pinKey))continue;
  const label=pin.revision||pin.tag,dir=join(sourcePlan.buildCacheRoot||root,'builds',engine+'-'+label.replace(/[^a-zA-Z0-9.-]/g,'_'));await mkdir(dir,{recursive:true});
  try{
   let revision=pin.revision;const repo=join(root,'repositories',engine);await mkdir(repo,{recursive:true});if(!await stat(join(repo,'.git')).catch(()=>null)){await run('git',['init',repo]);await run('git',['-C',repo,'remote','add','origin','https://github.com/'+pin.repository+'.git']);}
   await run('git',['-C',repo,'fetch','--depth','1','origin',revision||'refs/tags/'+pin.tag]);
   if(!revision){const fd=log.openSync(join(root,'build.log'),'a');revision=await new Promise((yes,no)=>{const p=spawn('git',['-C',repo,'rev-parse','FETCH_HEAD^{commit}'],{env,stdio:['ignore','pipe',fd]});let out='';p.stdout.on('data',d=>out+=d);p.on('exit',n=>n===0?yes(out.trim()):no(Error('Cannot resolve release')))});log.closeSync(fd)}
   const checkout=join(dir,'sources',engine);await mkdir(join(dir,'sources'),{recursive:true});if(!await stat(checkout).catch(()=>null))await run('git',['-C',repo,'worktree','add','--detach',checkout,revision]);
   const bound={...pin,targetType:'main',revision,configurations:pin.configurations};await writeFile(join(dir,'pins.json'),JSON.stringify({pins:[bound]}));
   const inventory=new Map(template.workloads.map(w=>[w.id,w.sha256]));const suite=(await readCache(template.corpusRoot)).filter(w=>inventory.has(w.id));if(suite.length!==inventory.size)throw Error('Frozen corpus incomplete');await writeFile(join(dir,'suite.json'),JSON.stringify(suite));
   let harness,controller=template.controller,jobEnv={};
   const unavailable=engine==='wago'?await wagoArchitectureUnavailable(checkout,env):null;
   if(unavailable){harness=frozen;await writeFile(join(dir,'unsupported-platform.json'),JSON.stringify(unavailable,null,2));}
   else if(engine==='wasm2go'){
    harness=template.jobs.find(j=>j.engine===engine)?.harness;if(!harness)throw Error('Missing translator adapter binding');let translator=join(dir,'wasm2go');await run('go',['build','-trimpath','-o',translator,'.'],{cwd:checkout});jobEnv.WASMBENCH_WASM2GO=translator;controller=template.jobs.find(j=>j.engine===engine)?.controller||controller;
   }else{if(!await stat(join(dir,engine+'-build.json')).catch(()=>null))await run(process.execPath,[join(process.cwd(),'scripts/weekly-build.mjs'),dir,engine,frozen],{cwd:process.cwd()});const receipt=JSON.parse(await readFile(join(dir,engine+'-build.json')));harness=receipt.root;controller=receipt.controller;jobEnv=receipt.env||{};}
   const jobs=pin.configurations.map(configuration=>({id:'history-'+template.collection.samples+'-'+configuration+'-'+revision.slice(0,12)+'-'+pin.targetType+'-'+pin.targetWeek.replace(/[^0-9]/g,'')+(pin.dateBasis&&pin.tag?'-'+pin.tag.replace(/[^a-zA-Z0-9.-]/g,'_'):''),engine:configuration,historical:true,harness,controller,env:jobEnv,...(unavailable?{unavailableReason:unavailable.reason,backend:'railshot-jit'}:{}),source:{repository:pin.repository,revision,ref:pin.tag||'main@'+revision.slice(0,12),asOf:pin.targetWeek,kind:pin.tag?'release':'snapshot',...(pin.dateBasis?{dateBasis:pin.dateBasis}:{})}}));
   const runDir=join(dir,'runs',pin.targetType+'-'+pin.targetWeek.replace(/[^0-9]/g,'')+(pin.dateBasis&&pin.tag?'-'+pin.tag.replace(/[^a-zA-Z0-9.-]/g,'_'):''));await mkdir(runDir,{recursive:true});await writeFile(join(runDir,'plan.json'),JSON.stringify({...template,captureDirectory:join(root,'captures'),anchor:sourcePlan.anchor,cutoff:sourcePlan.cutoff,jobs}));await run(process.execPath,[join(process.cwd(),'scripts/benchmark-history-worker.mjs'),runDir],{cwd:process.cwd()});const result=JSON.parse(await readFile(join(runDir,'status.json')));if(result.status!=='completed'||result.completed!==suite.length*jobs.length)throw Error('Incomplete collection: '+result.status+'; '+result.errors.length+' errors');progress.completed.push({pinKey,engine,revision,asOf:pin.targetWeek,configurations:pin.configurations,captures:result.completed});
  }catch(error){progress.errors.push({engine,label,pinKey,error:String(error)});console.error(error)}
  await writeFile(join(root,'build-status.json'),JSON.stringify({...progress,updated:new Date().toISOString()},null,2));
 }
}
