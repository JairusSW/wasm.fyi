import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {selectV8CacheDisableFlag} from './v8-cache-flag.mjs';
import {v8SingleCoreFlags} from './v8-single-core-mode.mjs';
import {applyV8NativeCompileOptions} from './v8-native-compile-options.mjs';
export function withV8NativeSizePolicy(source){
 if(source.includes('qualifiedNativeDiagnosticFlags'))return source;
 const old="['--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation','--no-wasm-native-module-cache','--print-wasm-code','-e',program,artifact,moduleSha256]";
 if(!source.includes(old)||!source.includes('const nativeDiagnosticTimeoutMs = 30 * 60 * 1000;'))throw Error('V8 native-size policy seam differs');
 const policy=`\nfunction qualifiedNativeDiagnosticFlags(){\n const options=spawnSync(process.execPath,['--v8-options'],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024,env:{...process.env,NODE_OPTIONS:''}});\n if(options.error||options.status!==0)throw Error('Pinned V8 options discovery failed');\n const selectV8CacheDisableFlag=${selectV8CacheDisableFlag.toString()};\n const v8CacheDisableFlags=['--no-wasm-native-module-cache','--no-wasm-native-module-cache-enabled'];\n const selected=selectV8CacheDisableFlag(options.stdout);\n const declared=process.env.WASMBENCH_V8_CACHE_DISABLE_FLAG;\n if(declared&&declared!==selected)throw Error('Declared V8 cache flag differs from pinned executable');\n return ${JSON.stringify(v8SingleCoreFlags)}.concat(['--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation',selected]);\n}\n`;
 return source.replace("import { spawn } from 'node:child_process';","import { spawn, spawnSync } from 'node:child_process';"+policy).replace('const nativeDiagnosticTimeoutMs = 30 * 60 * 1000;','const nativeDiagnosticTimeoutMs = 290 * 1000;').replace(old,"[...qualifiedNativeDiagnosticFlags(),'--print-wasm-code','-e',program,artifact,moduleSha256]");
}
export async function applyV8NativeSizePolicy(root){const file=join(root,'adapters/v8/native-size.mjs');const source=await readFile(file,'utf8'),next=withV8NativeSizePolicy(source);if(next!==source)await writeFile(file,next);await applyV8NativeCompileOptions(root);return next!==source;}
