import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const wasm3FeatureCMakeFlags=['-DCMAKE_C_FLAGS=-Dd_m3GuardedMemory=0'];

// m3_LoadModule transfers the module to the runtime before it initializes
// memory. A later initialization error still leaves the runtime as owner.
// Mark that transfer before checking the result so the adapter cannot free the
// same module again. This matters for rejected custom-page-size allocations.
export function wasm3FeatureEmbeddingSource(source){
 if(source.includes('// wasmfyi wasm3 load ownership v1'))return source;
 const before='check(m3_LoadModule(m->runtime,m->module));m->loaded=true;';
 const after='// wasmfyi wasm3 load ownership v1\n    M3Result loaded=m3_LoadModule(m->runtime,m->module);m->loaded=true;check(loaded);';
 if(source.split(before).length!==2)throw Error('Wasm3 load ownership source contract changed');
 return source.replace(before,after);
}

export async function applyWasm3FeaturePolicy(root){
 const path=join(root,'adapters/native/src/wasm3.cpp');
 await writeFile(path,wasm3FeatureEmbeddingSource(await readFile(path,'utf8')));
}
