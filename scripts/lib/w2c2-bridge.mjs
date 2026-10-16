import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

export async function applyW2c2Bridge(root) {
 const file=join(root,'adapters/native/src/aot.rs');
 const before=await readFile(file,'utf8');
 const bridge=await readFile(new URL('../../adapters/qualification/aot_bridge.rs',import.meta.url),'utf8');
 const definition=bridge.indexOf('fn w2c2_legacy(');
 if(definition<0)throw Error('W2c2 bridge definition missing');
 const start=before.includes('fn w2c2_legacy(')?before.indexOf('fn w2c2_legacy('):before.indexOf('fn ctype(');
 const end=before.indexOf('#[derive(Clone)]\nstruct Stage',start);
 if(start<0||end<start)throw Error('W2c2 native bridge seam changed');
 let after=before.slice(0,start)+bridge.slice(definition)+'\n'+before.slice(end);
 const symbol='format!(\n                "m2_wbExport{}_{}",\n                name.len(),\n                name.replace("X", "X58").replace("_", "X5F")\n            )';
 for(const [old,value] of [
  [symbol,'w2c2_export_symbol(header, &name)'],
  ['"m2_wbExport6_memory".into()','w2c2_export_symbol(header, "memory")'],
  ['bridge(c.wasm2c(), &exports, &memory, identity, abort)','bridge(c.wasm2c(), &exports, &memory, identity, abort, &header)'],
 ]) {
  if(after.includes(old))after=after.replace(old,value);
  else if(!after.includes(value))throw Error('W2c2 generated symbol seam changed');
 }
 if(after!==before)await writeFile(file,after);
 return {policy:'generated-header-selected-w2c2-abi-v1',sdkModified:false,beforeSha256:digest(Buffer.from(before)),adapterSha256:digest(Buffer.from(after)),bridgeSha256:digest(Buffer.from(bridge))};
}
