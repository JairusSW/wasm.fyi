// Bridge SDK reuse into collectors started before historyBuildDirectory existed.
// Only SDK build receipts/harnesses are reused. Captures and job status stay separate.
import {readFile,readdir,stat,mkdir,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {digest} from './lib/wasmbench.mjs';
export const sdkIdentity=pin=>[pin.engine,pin.targetType,pin.tag||pin.revision].join('|');
export async function reuseActiveHistorySDKs(root) {
 const plan=JSON.parse(await readFile(join(root,'source-plan.json')));
 const builds=join(root,'engine-builds'),available=new Map();
 for(const directoryName of await readdir(builds)){
  if(!directoryName.startsWith('wasmtime-'))continue;
  const directory=join(builds,directoryName);
  if(await stat(join(directory,'sdk-reuse.json')).catch(()=>null))continue;
  for(const filename of ['wasmtime-build.json','binding.json']){
   const path=join(directory,filename),text=await readFile(path,'utf8').catch(()=>null);if(!text)continue;
   const receipt=JSON.parse(text),pin=receipt.pin||receipt.release;if(pin?.engine!=='wasmtime')continue;
   const harness=receipt.root||join(directory,'harness');
   if(!await stat(join(harness,'adapters/wasmtime/target/release/adapter-wasmtime')).catch(()=>null))continue;
   const manifest=await readFile(join(harness,'adapters/wasmtime/Cargo.toml'),'utf8');
   if(!manifest.includes('"winch"')||!manifest.includes('"cranelift"'))continue;
   if(await stat(join(harness,'adapters/wasmtime/Cargo.toml')).catch(()=>null))available.set(sdkIdentity(pin),{directory,harness,filename,receipt,receiptSha256:digest(Buffer.from(text))});
  }
 }
 let reused=0;
 for(const pin of plan.pins.filter(pin=>pin.engine==='wasmtime'&&pin.status==='planned')){
  const original=available.get(sdkIdentity(pin));if(!original)continue;
  for(const configuration of pin.configurations){
   const label=[configuration,pin.tag||pin.revision,pin.targetType,pin.targetWeek].join('-').replace(/[^a-zA-Z0-9.-]/g,'_');
   const destination=join(builds,label);
   // Existing directories may belong to an active build. Never modify them.
   try{await mkdir(destination);}catch(error){if(error.code==='EEXIST')continue;throw error;}
   const receipt=structuredClone(original.receipt);
   if(pin.targetType==='main')receipt.pin={...pin,configurations:[configuration]};else {receipt.configuration=configuration;receipt.release=pin;}
   await symlink(original.harness,join(destination,'harness'));
   await writeFile(join(destination,'sdk-reuse.json'),JSON.stringify({sourceDirectory:original.directory,sourceReceiptSha256:original.receiptSha256,identity:sdkIdentity(pin),policy:'Shared SDK includes both Cranelift and Winch; runtime strategy remains selected per collection job; no captures reused'},null,2)+'\n');
   // Publish last: a receipt is the old collector's ready signal.
   await writeFile(join(destination,original.filename),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
   reused++;
  }
 }
 return {reused,qualifiedSources:available.size};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))console.log(JSON.stringify(await reuseActiveHistorySDKs(resolve(process.argv[2]))));
