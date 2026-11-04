import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {withBuildLock} from './lib/measurement-lock.mjs';
import {ensureWasmtimeFeatureBinding} from './lib/wasmtime-feature-policy.mjs';
const root=resolve(process.argv[2]);
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const config=await read(join(root,'runner-config.json')),template=await read(join(root,'collection-template.json'));
await withBuildLock(root,async()=>{
 for(const name of await readdir(join(root,'sdk-builds'))){
  const directory=join(root,'sdk-builds',name),receipt=await read(join(directory,'wasmtime-build.json')).catch(()=>null);
  if(!receipt)continue;
  const result=await ensureWasmtimeFeatureBinding(directory,receipt,template.env,{inputs:config.inputs});
  console.log(JSON.stringify({policy:result.policy,revision:result.revision,qualified:result.qualified,controller:result.controller,builtAt:result.builtAt}));return;
 }
 throw Error('Wasmtime SDK receipt absent');
});
