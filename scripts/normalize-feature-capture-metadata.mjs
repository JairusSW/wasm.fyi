import {readFile,writeFile,readdir,mkdir,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {totalmem} from 'node:os';
import {normalizeFeatureCaptureMetadata} from './lib/feature-capture-metadata.mjs';
import {withBuildLock} from './lib/measurement-lock.mjs';
const campaign=resolve(process.argv[2]),root=resolve(process.argv[3]);
await withBuildLock(campaign,async()=>{
 for(const name of await readdir(join(root,'captures')).catch(()=>[])){
  if(!name.startsWith('feature-')||!name.endsWith('.json'))continue;
  const original=await readFile(join(root,'captures',name)),changed=normalizeFeatureCaptureMetadata(original,totalmem());if(original.equals(changed))continue;
  await mkdir(join(root,'raw-captures'),{recursive:true});await writeFile(join(root,'raw-captures',name),original,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e});
  for(const directory of [join(root,'captures'),join(campaign,'captures')]){const tmp=join(directory,name+'.memory-tmp');await writeFile(tmp,changed);await rename(tmp,join(directory,name));}
 }
});
