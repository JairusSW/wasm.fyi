import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export function withV8BigIntBinding(source){
 const marker='// wasm-fyi typed BigInt argument binding v1';
 if(source.includes(marker))return source;
 const declaration='let floatSignature;';
 const args="function argumentsForCall() {if(floatSignature)return floatArguments(prep.workload.args,floatSignature.params);return prep.workload.args.map(x=>{const n=Number(x);if(!Number.isSafeInteger(n))throw new Error('i64 arguments require typed argument support');return n;});}";
 const reset='floatSignature=undefined; module=instance=undefined;';
 const prepare='floatSignature=numericSignature(bytes,prep.workload.export);\n        validateFloat(prep.workload.oracle,floatSignature.results);';
 for(const seam of [declaration,args,reset,prepare])if(!source.includes(seam))throw Error('V8 BigInt binding seam changed: '+seam);
 return source
  .replace(declaration,`${marker}\nlet floatSignature,integerSignature;`)
  .replace(args,"function argumentsForCall() {if(floatSignature)return floatArguments(prep.workload.args,floatSignature.params);if(integerSignature)return floatArguments(prep.workload.args,integerSignature.params);return prep.workload.args.map(x=>{const n=Number(x);if(!Number.isSafeInteger(n))throw new Error('i64 arguments require typed argument support');return n;});}")
  .replace(reset,'floatSignature=integerSignature=undefined; module=instance=undefined;')
  .replace(prepare,`${prepare}\n      } else if(prep.workload.features?.includes('big-int')) {\n        integerSignature=numericSignature(bytes,prep.workload.export);\n        if(!integerSignature.params.includes('i64'))throw new Error('BigInt workload lacks an i64 parameter');`);
}

export async function applyV8BigIntBinding(root){
 const file=join(root,'adapters/v8/adapter.mjs'),before=await readFile(file,'utf8'),after=withV8BigIntBinding(before);
 if(before!==after)await writeFile(file,after);
 return before!==after;
}
