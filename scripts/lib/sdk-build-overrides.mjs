import {readFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {digest} from './wasmbench.mjs';

const selectors=new Set(['WASMFYI_BUILD_PYTHON','WASMFYI_SPIDERMONKEY_CXX_SDK','WASMFYI_SPIDERMONKEY_LEGACY_RUST','WASMFYI_SPIDERMONKEY_LEGACY_PYTHON','WASMFYI_SPIDERMONKEY_LEGACY_CLANG']);

// Opt-in campaign file: update future SDK children of long-running sweeps.
// Runtime settings, sampling policy, source pins and cached SDKs are unchanged.
export async function sdkBuildOverrides(directory,engine) {
 const parent=resolve(directory,'..');
 if(!['sdk-builds','engine-builds'].includes(basename(parent)))return null;
 const file=resolve(parent,'../sdk-build-overrides.json');
 const bytes=await readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error});
 if(bytes===null)return null;
 const value=JSON.parse(bytes);
 if(value.schema!==1||!value.engines||typeof value.engines!=='object'||Array.isArray(value.engines))throw Error('Invalid SDK build override schema');
 const selected=value.engines[engine];if(selected===undefined)return null;
 if(engine!=='spidermonkey'||!selected||typeof selected!=='object'||Array.isArray(selected))throw Error('Unsupported SDK build override engine');
 for(const [key,text] of Object.entries(selected)) {
  if(!selectors.has(key)||typeof text!=='string')throw Error('Unsupported SDK build override selector: '+key);
  if(key==='WASMFYI_SPIDERMONKEY_LEGACY_RUST') {
   if(!/^\d+\.\d+\.\d+$/.test(text))throw Error('Invalid SDK Rust selector');
  }else if(!text.startsWith('/')||/[\s\0"'`$]/.test(text))throw Error('Unsafe SDK tool path');
 }
 return {env:{...selected},provenance:{file,sha256:digest(bytes),selectors:Object.keys(selected).sort()}};
}
