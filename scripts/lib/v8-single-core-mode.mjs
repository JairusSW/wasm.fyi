import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
export const v8SingleCoreFlags=Object.freeze(['--single-threaded','--single-threaded-gc','--wasm-num-compilation-tasks=0']);

export async function applyV8SingleCoreMode(root) {
 const file=join(root,'adapters/v8/compiler-mode.mjs');
 if(!await stat(file).catch(()=>null))return false;
 const source=await readFile(file,'utf8');
 if(source.includes('const singleCoreCompilerFlags='))return false;
 const previousPrefix="const singleThreaded=['--single-threaded','--single-threaded-gc','--wasm-num-compilation-tasks=0'];";
 const previousSelection='const controlled=singleThreaded.every((flag,index)=>flags[index]===flag)?flags.slice(singleThreaded.length):flags;';
 const previousGuard="if(JSON.stringify(controlled)!==JSON.stringify(expected) && JSON.stringify(controlled)!==JSON.stringify([...expected,'--no-wasm-native-module-cache']))";
 if(source.includes(previousPrefix)&&source.includes(previousSelection)&&(source.includes(previousGuard)||source.includes("JSON.stringify(controlled)!==JSON.stringify([...expected,'--no-wasm-native-module-cache-enabled'])")))return false;
 const guard="if(JSON.stringify(flags)!==JSON.stringify(expected) && JSON.stringify(flags)!==JSON.stringify([...expected,'--no-wasm-native-module-cache']))";
 if(!source.includes(guard))throw Error('V8 controlled compiler flag contract changed');
 const next=source.replace(guard,`const singleCoreCompilerFlags=${JSON.stringify(v8SingleCoreFlags)};
  const verifiedSequences=[expected,[...expected,'--no-wasm-native-module-cache'],[...singleCoreCompilerFlags,...expected],[...singleCoreCompilerFlags,...expected,'--no-wasm-native-module-cache']];
  if(!verifiedSequences.some(sequence=>JSON.stringify(flags)===JSON.stringify(sequence)))`);
 await writeFile(file,next);
 return true;
}
