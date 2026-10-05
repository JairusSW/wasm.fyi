// Retire regenerable compiler caches after a complete sealed week. Keep native
// runners, analyzers, receipts, parent bundles and every measurement byte.
import assert from 'node:assert/strict';
import {readFile,readdir,stat,mkdir,rename,rm,link} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {randomUUID} from 'node:crypto';
const directory=resolve(process.argv[2]);
assert(/\/weekly-\d{8}$/.test(directory),'Expected a retained native weekly directory');
assert(!/weekly-2026(?:1003|0926)$/.test(directory),'Initial delivered capture caches are preserved');
const state=JSON.parse(await readFile(join(directory,'weekly-run.json')));assert.equal(state.status,'collected','Cannot retire an incomplete week');
const retirementFile=join(directory,'cache-retirement.json');
const recovery=await readFile(retirementFile,'utf8').then(JSON.parse,()=>null);
for(const [file,temp] of recovery?.preserved??[])if(await stat(temp).catch(()=>null)){await mkdir(dirname(file),{recursive:true});await rename(temp,file);}
const keep=new Set(),targets=new Set();
for(const file of await readdir(directory))if(file.endsWith('-build.json')){
 const receipt=JSON.parse(await readFile(join(directory,file)));
 keep.add(receipt.controller);keep.add(join(receipt.root,'adapters/wasmtime/target/release/wasm-analyze'));
 for(const arg of receipt.runtime.command)if(arg.startsWith(directory+'/'))keep.add(arg);
 targets.add(join(receipt.root,'adapters/wasmtime/target'));targets.add(join(receipt.root,'adapters/native/target'));
}
targets.add(join(directory,'sources/wasmer/target'));targets.add(join(directory,'sources/v8/out'));
for(const target of targets){
 if(!await stat(target).catch(()=>null))continue;
 const preserved=[];
 for(const file of keep)if(file.startsWith(target+'/')&&await stat(file).catch(()=>null)){
  const temp=join(directory,'.retained-'+randomUUID());await link(file,temp);preserved.push([file,temp]);
 }
 await atomicJSON(retirementFile,{target,preserved,status:'retiring'});
 await rm(target,{recursive:true,force:true});
 for(const [file,temp] of preserved){await mkdir(dirname(file),{recursive:true});await rename(temp,file);}
 await atomicJSON(retirementFile,{target,preserved:[],status:'retired'});
 console.log('Retired native build cache '+target+'; '+preserved.length+' executable artifacts preserved');
}
