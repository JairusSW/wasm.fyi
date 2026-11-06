import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest,site} from './wasmbench.mjs';

// Reuse the qualified lifecycle/session driver, with its internal Rust embedding
// feature name. The measured engine, dependency and description are Submilli.
export async function buildSubmilliSDK({source,root,version,env,run}) {
 const dir=join(root,'submilli-adapter');await mkdir(join(dir,'src'),{recursive:true});
 let main=await readFile(join(root,'adapters/native/src/main.rs'),'utf8');
 main=main.replace('env!("WB_RUNTIME")','"submilli"').replace(/"(?:portable|auto|indirect)-dispatch; eager bytecode; no fuel[^"]*"/g,'"Submilli stack interpreter; SIMD enabled; no fuel or epoch interruption"').replaceAll('"wasmi_dispatch"','"interpreter_policy"');
 main=main.replace('let assemblyscript = (cfg!(feature = "wasmer_llvm")','let assemblyscript = (cfg!(feature = "wasmi") || cfg!(feature = "wasmer_llvm")');
 main=main.replaceAll('#[cfg(any(\n    feature = "wasmer_llvm",','#[cfg(any(\n    feature = "wasmi",\n    feature = "wasmer_llvm",').replaceAll('#[cfg(any(\n                    feature = "wasmer_llvm",','#[cfg(any(\n                    feature = "wasmi",\n                    feature = "wasmer_llvm",').replace('let vector_contract = (cfg!(feature = "wasmer_llvm")','let vector_contract = (cfg!(feature = "wasmi") || cfg!(feature = "wasmer_llvm")');
 main=main.replace('if cfg!(feature = "wasmer_llvm")\n                    || cfg!(feature = "wasmer_singlepass")','if cfg!(feature = "wasmi") || cfg!(feature = "wasmer_llvm")\n                    || cfg!(feature = "wasmer_singlepass")');
 await copyFile(join(root,'adapters/native/src/vectors.rs'),join(dir,'src/vectors.rs'));
 await writeFile(join(dir,'src/main.rs'),main);
 await copyFile(join(site,'adapters/qualification/submilli.rs'),join(dir,'src/wasmi.rs'));
 await writeFile(join(dir,'Cargo.toml'),`[package]\nname="wasmfyi-submilli"\nversion="0.1.0"\nedition="2021"\n[workspace]\n[features]\ndefault=["wasmi"]\nwasmi=[]\n[dependencies]\nanyhow="1"\nserde_json="1"\nsha2="0.10"\nhex="0.4"\nwasmparser="0.252"\nsubmilli-wasm={path=${JSON.stringify(source)},features=["simd"]}\n`);
 await run('cargo',['build','--release','--manifest-path',join(dir,'Cargo.toml')],{env:{...env,SUBMILLI_REVISION:version}});
 const binary=join(root,'bin/adapter-submilli');await copyFile(join(dir,'target/release/wasmfyi-submilli'),binary);
 return {source,revision:version,features:['simd'],fuel:false,epochInterruption:false,nativeCode:'not applicable: interpreter',adapterSha256:digest(await readFile(binary))};
}
