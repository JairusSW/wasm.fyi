import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
export const v8CacheDisableFlags=Object.freeze(['--no-wasm-native-module-cache','--no-wasm-native-module-cache-enabled']);
export function selectV8CacheDisableFlag(options) {
 const names=new Set([...String(options).matchAll(/^\s*(--wasm-native-module-cache(?:-enabled)?)(?=\s|\()/gm)].map(x=>x[1]));
 if(names.has('--wasm-native-module-cache'))return v8CacheDisableFlags[0];
 if(names.has('--wasm-native-module-cache-enabled'))return v8CacheDisableFlags[1];
 throw Error('Pinned V8 exposes no qualified native-module-cache disable flag');
}
export async function applyV8CacheFlag(root) {
 const runner=join(root,'experiment/runner.go');if(await stat(runner).catch(()=>null)){
  const source=await readFile(runner,'utf8'),seam='r.Command = append(r.Command, "--no-wasm-native-module-cache")';
  if(!source.includes('WASMBENCH_V8_CACHE_DISABLE_FLAG')&&source.includes(seam))await writeFile(runner,source.replace(seam,`cacheFlag := os.Getenv("WASMBENCH_V8_CACHE_DISABLE_FLAG")
                if cacheFlag == "" { cacheFlag = "--no-wasm-native-module-cache" }
                if cacheFlag != "--no-wasm-native-module-cache" && cacheFlag != "--no-wasm-native-module-cache-enabled" { return nil, fmt.Errorf("invalid V8 cache disable flag %q", cacheFlag) }
                r.Command = append(r.Command, cacheFlag)`));
 }
 const parser=join(root,'adapters/v8/compiler-mode.mjs');if(!(await stat(parser).catch(()=>null)))return false;
 const source=await readFile(parser,'utf8');if(source.includes('--no-wasm-native-module-cache-enabled'))return false;
 if(!source.includes("'--no-wasm-native-module-cache'"))throw Error('V8 compiler parser cache flag seam changed');
 // Expand each exact modern sequence with the semantically identical legacy
 // spelling. Flags remain ordered; contradictory and missing tier flags fail.
 const replacement="[...expected,'--no-wasm-native-module-cache']";
 let next=source;
 if(source.includes('const verifiedSequences='))next=source.replace('const verifiedSequences=[',"const verifiedSequences=[[...expected,'--no-wasm-native-module-cache-enabled'],[...singleCoreCompilerFlags,...expected,'--no-wasm-native-module-cache-enabled'],");
 else if(source.includes('const controlled=singleThreaded.every'))next=source.replace("JSON.stringify(controlled)!==JSON.stringify("+replacement+")", "JSON.stringify(controlled)!==JSON.stringify("+replacement+") && JSON.stringify(controlled)!==JSON.stringify([...expected,'--no-wasm-native-module-cache-enabled'])");
 else next=source.replace("JSON.stringify(flags)!==JSON.stringify("+replacement+")", "JSON.stringify(flags)!==JSON.stringify("+replacement+") && JSON.stringify(flags)!==JSON.stringify([...expected,'--no-wasm-native-module-cache-enabled'])");
 if(next===source)throw Error('V8 parser exact flag sequence changed');await writeFile(parser,next);return true;
}
