import {readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withBuildLock} from './lib/measurement-lock.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
const root=resolve(process.argv[2]),read=async p=>JSON.parse(await readFile(p,'utf8'));
const template=await read(join(root,'collection-template.json')),plan=await read(join(root,'source-plan.json'));
const target=await realpath(template.env.WASMFYI_WASMER_BUILD_CACHE);
if(!target.endsWith('/toolchains/wasmer-cargo-cache/target'))throw Error('Unexpected Wasmer build-cache location');
await withBuildLock(root,async()=>{
 const pin=plan.pins.find(pin=>pin.engine==='wasmer');
 if(!pin)throw Error('Wasmer source pin absent');
 const processes=execFileSync('ps',['-axo','command='],{encoding:'utf8'}).split('\n');
 if(processes.some(command=>command.includes(target)||/\/sdk-builds\/wasmer-[^ ]/.test(command)))throw Error('Wasmer process still active');
 await runCommand(process.execPath,[join(import.meta.dirname,'audit-current-campaign.mjs'),root,...pin.configurations],{cwd:import.meta.dirname});
 const audit=await read(join(root,'coverage-audit-selected.json'));
 if(!audit.complete||audit.engines.length!==pin.configurations.length||audit.engines.some(engine=>engine.revision!==pin.revision))throw Error('Wasmer captures are incomplete');
 for(const name of await readdir(join(root,'sdk-builds'))){
  const receipt=await read(join(root,'sdk-builds',name,name.split('-')[0]+'-build.json')).catch(()=>null);
  if(!receipt)continue;
  for(const file of Object.keys(receipt.runtime?.file_sha256||{})){
   const path=await realpath(file);
   if(path===target||path.startsWith(target+sep))throw Error('Sealed runtime depends on compiler cache: '+path);
  }
 }
 await rm(target,{recursive:true});
 const receipt={at:new Date().toISOString(),removed:target,revision:pin.revision,retained:'All captures, SDK libraries, adapters, controllers and source'};
 await writeFile(join(root,'wasmer-target-prune.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
});
