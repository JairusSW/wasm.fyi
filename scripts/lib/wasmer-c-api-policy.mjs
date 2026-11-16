import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

export async function applyWasmerCapiPolicy({root,sdk,source}) {
 const header=await readFile(join(sdk,'include/wasmer.h'),'utf8');
 const adapterPath=join(root,'adapters/native/src/wasmer.cpp');
 const adapter=await readFile(adapterPath,'utf8');
 const memory64Call='    wasmer_features_memory64(features,false);';
 if(header.includes('wasmer_features_memory64(')) {
  if(!adapter.includes(memory64Call))throw Error('Wasmer memory64 C API setter exists but adapter policy anchor is missing');
  return {memory64:'disabled-through-C-API'};
 }
 if(!adapter.includes(memory64Call))throw Error('Wasmer memory64 adapter policy anchor is missing');
 const features=await readFile(join(source,'lib/types/src/features.rs'),'utf8');
 const defaults=features.match(/pub fn new\(\)\s*->\s*Self\s*\{([\s\S]*?)\n\s*\}/)?.[1];
 if(!defaults||!/_memory64\s*:\s*false/.test(defaults))throw Error('Wasmer C API has no memory64 setter and its SDK default could not be verified as disabled');
 await writeFile(adapterPath,adapter.replace(memory64Call,'    // This SDK has no memory64 setter; its verified default is disabled.'));
 return {memory64:'disabled-by-verified-SDK-default',adapterSha256:digest(await readFile(adapterPath))};
}
