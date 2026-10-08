import {readFile,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
export function historyBuildKey(pin,configuration) {
 const backend=pin.engine==='wasmtime'?'wasmtime':configuration;
 return [backend,pin.targetType,pin.tag||pin.revision].join('-').replace(/[^a-zA-Z0-9.-]/g,'_');
}
export async function historyBuildDirectory(root,pin,configuration) {
 const plan=await readFile(join(root,'source-plan.json'),'utf8').then(JSON.parse,()=>null);
 if(plan?.buildCacheRoot&&plan.buildCacheRoot!==root){const cached=await historyBuildDirectory(plan.buildCacheRoot,pin,configuration);if(await stat(cached).catch(()=>null))return cached;}
 const canonical=join(root,'sdk-builds',historyBuildKey(pin,configuration));
 if(await stat(canonical).catch(()=>null))return canonical;
 const legacy=join(root,'engine-builds'),backend=pin.engine==='wasmtime'?'wasmtime':configuration;
 for(const name of await readdir(legacy).catch(()=>[])) {
  if(!name.startsWith(backend+'-'))continue;
  const directory=join(legacy,name),receipt=await readFile(join(directory,pin.targetType==='main'?pin.engine+'-build.json':'binding.json'),'utf8').then(JSON.parse,()=>null);
  const original=receipt?.pin||receipt?.release;
  if(original?.engine!==pin.engine||original.targetType!==pin.targetType)continue;
  if(pin.engine!=='wasmtime'&&(receipt.configuration||original.configurations?.[0])!==configuration)continue;
  if(pin.targetType==='main'?original.revision===pin.revision:original.tag===pin.tag)return directory;
 }
 return canonical;
}
