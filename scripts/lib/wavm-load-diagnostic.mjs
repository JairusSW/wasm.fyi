import{readFile,writeFile}from'node:fs/promises';import{join}from'node:path';
export function withWavmLoadDiagnostic(source){
 if(source.includes('C API module compilation failed; independent SDK loader accepted module'))return source;
 const anchor='    if(!m)throw std::runtime_error("module compilation failed");return m;';
 if(!source.includes(anchor))throw Error('WAVM failed-module diagnostic seam absent');
 return source.replace(anchor,`    if(!m){
        WAVM::Runtime::ModuleRef diagnostic;
        WAVM::WASM::LoadError error;
        if(!WAVM::Runtime::loadBinaryModule(data,size,diagnostic,WAVM::IR::FeatureSpec(),&error))
            throw std::runtime_error("module compilation failed: "+error.message);
        throw std::runtime_error("C API module compilation failed; independent SDK loader accepted module");
    }return m;`);
}
export async function applyWavmLoadDiagnostic(root){const p=join(root,'adapters/native/src/wavm.cpp'),before=await readFile(p,'utf8');const after=withWavmLoadDiagnostic(before);if(before!==after){await writeFile(p+'.before-load-diagnostic',before);await writeFile(p,after);}}
