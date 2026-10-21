import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function wasmerNativeSizeGetter(root) {
 const canonical=await readFile(new URL('../patches/wasmer-native-size.rs',import.meta.url),'utf8');
 const installed=await readFile(join(root,'adapters/native/wasmer-native-size.rs'),'utf8').catch(error=>{
  if(error?.code==='ENOENT')return null;
  throw error;
 });
 if(installed!==null&&installed!==canonical)throw Error('Wasmer native-size observer differs from the source-pinned site patch');
 return canonical;
}
