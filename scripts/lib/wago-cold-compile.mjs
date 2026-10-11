// Change only the benchmark embedding; never the selected runtime source.
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from './wasmbench.mjs';
const original='\tif e := a.setup(); e != nil {\n\t\treturn nil, e\n\t}\n\tvar serialized []byte';
const replacement='\t// Compile samples validate their own fresh module; no unmeasured setup compile.\n\tif r.Scenario != "compile" {\n\t\tif e := a.setup(); e != nil {\n\t\t\treturn nil, e\n\t\t}\n\t}\n\tvar serialized []byte';
export async function applyWagoColdCompile(root){
 const file=join(root,'adapters/wago/main.go');
 let source=await readFile(file,'utf8');
 if(source.includes(original)){
  if(source.split(original).length!==2)throw Error('Wago compile preparation seam is ambiguous');
  source=source.replace(original,replacement);await writeFile(file,source);
 }else if(!source.includes(replacement))throw Error('Wago compile preparation seam changed');
 await copyFile(fileURLToPath(new URL('../../adapters/wago/cold_compile_test.go',import.meta.url)),join(root,'adapters/wago/cold_compile_test.go'));
 return {policy:'fresh-sdk-compile-verified-v1',extraSetupCompile:false,verification:'instantiate and check the newly timed module outside compilation timing',sdkModified:false,adapterMainSha256:digest(Buffer.from(source))};
}
