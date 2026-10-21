import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

export async function prepareLibWasmAdapter(template,directory,abstractMachineHeader){
 const target=join(directory,'adapter-native');
 await rm(target,{recursive:true,force:true});
 await mkdir(directory,{recursive:true});
 await cp(template,target,{recursive:true});
 const sourcePath=join(target,'src/libwasm.cpp');
 const original=await readFile(sourcePath,'utf8');
 let source=original;
 const policies=[];
 if(!abstractMachineHeader.includes('ResultsStaticSize')){
  const seam='Vector<Wasm::Value,Wasm::ResultsStaticSize>';
  if(!source.includes(seam))throw Error('LibWasm host-result adapter seam changed');
  source=source.replaceAll(seam,'Vector<Wasm::Value>');
  policies.push('dynamic-result-vector');
 }
 if(!abstractMachineHeader.includes('contiguous_bytes_from')){
  const seam='if(memory->data().contiguous_bytes_from(0,*n)!=*n)throw std::runtime_error("unsupported: segmented linear-memory view");';
  if(!source.includes(seam))throw Error('LibWasm contiguous-memory adapter seam changed');
  source=source.replace(seam,'');
  policies.push('legacy-contiguous-memory');
 }
 if(source!==original)await writeFile(sourcePath,source);
 const policy=policies.join('+')||'current-api';
 const receipt={policy,templateSha256:digest(Buffer.from(original)),sourceSha256:digest(Buffer.from(source))};
 await writeFile(join(directory,'adapter-compatibility.json'),JSON.stringify(receipt,null,2)+'\n');
 return {root:target,receipt};
}
