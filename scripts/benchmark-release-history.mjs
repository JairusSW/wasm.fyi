// Release-specific build bindings; measurements use the same compact capture path.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {copyHistoricalHarness,buildHistoricalBinding} from './lib/historical-binding.mjs';
import {command} from './lib/wasmbench.mjs';
import {readCache} from './lib/benchmark-plan.mjs';
const [rootArg,baseArg]=process.argv.slice(2),root=resolve(rootArg),base=resolve(baseArg);
const source=JSON.parse(await readFile(join(root,'source-plan.json'))),template=JSON.parse(await readFile(join(root,'collection-template.json')));
const env={...process.env,...template.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',GOMAXPROCS:'1',CARGO_BUILD_JOBS:'1'};
const suite=(await readCache(template.corpusRoot)).filter(w=>w.id==='wago/tiny/add');
const status={started:new Date().toISOString(),completed:[],errors:[]};
for(const engine of ['wasmtime','v8','wasmer','wavm','wamr','wasmi','wasm3','jsc','spidermonkey','wasmedge','chicory','wasm2c','w2c2']){
 for(const pin of source.pins.filter(p=>p.engine===engine&&p.status==='planned'&&p.targetType==='release').sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek))){
  if(Date.parse(pin.targetWeek)<Date.parse(source.cutoff)||Date.parse(pin.targetWeek)>Date.parse(source.anchor))continue;
  for(const configuration of pin.configurations){
   const label=configuration+'-'+pin.tag.replace(/[^a-zA-Z0-9.-]/g,'_'),dir=join(root,'release-builds',label),harness=join(dir,'harness');await mkdir(dir,{recursive:true});
   try{
    if(!await stat(harness).catch(()=>null))await copyHistoricalHarness(base,harness);
    await writeFile(join(dir,'suite.json'),JSON.stringify(suite));
    const buildEnv={...env},controller=template.controller;
    const invoke=(...args)=>command(controller,args,{cwd:harness,env:buildEnv,timeout:120*60*1000,stdio:'inherit'});
    const binding=await buildHistoricalBinding({root:harness,pin,configuration,invoke,env:buildEnv});
    await writeFile(join(dir,'binding.json'),JSON.stringify(binding,null,2));
    const job={id:label,engine:configuration,historical:true,harness,controller,env:Object.fromEntries(Object.entries(buildEnv).filter(([k,v])=>k.startsWith('WASMBENCH_')&&v!==env[k])),source:{repository:pin.repository,revision:binding.source.revision||binding.source.archiveSha256||pin.tag,ref:pin.tag,asOf:pin.targetWeek,kind:'release'}};
    await writeFile(join(root,'plan.json'),JSON.stringify({...template,anchor:source.anchor,cutoff:source.cutoff,jobs:[job]}));
    command(process.execPath,[join(process.cwd(),'scripts/benchmark-history-worker.mjs'),root],{cwd:process.cwd(),env,timeout:48*60*60*1000,stdio:'inherit'});
    status.completed.push({engine,configuration,tag:pin.tag});
   }catch(error){status.errors.push({engine,configuration,tag:pin.tag,error:String(error)});console.error(error)}
   await writeFile(join(root,'release-status.json'),JSON.stringify({...status,updated:new Date().toISOString()},null,2));
  }
 }
}
