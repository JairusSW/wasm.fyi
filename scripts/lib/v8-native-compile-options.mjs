import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export function withV8NativeCompileOptions(source){
 if(source.includes('JSON.parse(process.argv[3])'))return source;
 const seams=['moduleSha256, mode)','new WebAssembly.Module(bytes);','program,artifact,moduleSha256]'];
 for(const seam of seams)if(!source.includes(seam))throw Error('V8 native compile-options seam changed: '+seam);
 return source.replace(seams[0],'moduleSha256, mode, compileOptions={})')
  .replace(seams[1],'new WebAssembly.Module(bytes,JSON.parse(process.argv[3]));')
  .replace(seams[2],'program,artifact,moduleSha256,JSON.stringify(compileOptions)]');
}
export async function applyV8NativeCompileOptions(root){
 const file=join(root,'adapters/v8/native-size.mjs'),before=await readFile(file,'utf8'),after=withV8NativeCompileOptions(before);
 if(before!==after)await writeFile(file,after);
 const adapter=join(root,'adapters/v8/adapter.mjs'),source=await readFile(adapter,'utf8');
 const seam="case 'inspect': return inspectNativeSize(prep.artifact,bytes,prep.artifact_sha256,compilerMode);";
 if(!source.includes('compilerMode,prep.workload.host_profile')){
  if(!source.includes(seam))throw Error('V8 native inspect call seam changed');
  await writeFile(adapter,source.replace(seam,"case 'inspect': return inspectNativeSize(prep.artifact,bytes,prep.artifact_sha256,compilerMode,prep.workload.host_profile==='js-string-builtins-v1'?{builtins:['js-string'],importedStringConstants:'strings'}:{});"));
 }
}
