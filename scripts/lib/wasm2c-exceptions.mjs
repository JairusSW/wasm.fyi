import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export function withWasm2cExceptions(source) {
 const translation='            vec!["wb.wasm", "-n", "wb", "-o", "wb.c"]';
 const featureTranslation='            vec!["wb.wasm", "--enable-custom-page-sizes", "-n", "wb", "-o", "wb.c"]';
 if(source.includes(translation))source=source.replace(translation,featureTranslation);
 else if(!source.includes(featureTranslation))throw Error('Wasm2c translation feature seam absent');
 const flags='                "-DWASM_RT_MEMCHECK_SIGNAL_HANDLER=0".into(),';
 if(!source.includes('"-D_POSIX_C_SOURCE=200809L".into()')) {
  if(!source.includes(flags))throw Error('Wasm2c POSIX runtime flags seam absent');
  source=source.replace(flags,'                "-D_POSIX_C_SOURCE=200809L".into(),\n'+flags);
 }
 if(source.includes('let exceptions = runtime.join("wasm-rt-exceptions-impl.c");'))return source;
 const anchor='                runtime.join("wasm-rt-mem-impl.c").display().to_string(),\n            ]);';
 if(!source.includes(anchor))throw Error('Wasm2c runtime compilation seam absent');
 return source.replace(anchor,anchor+'\n            // Newer WABT separates the exception runtime from the core runtime.\n            let exceptions = runtime.join("wasm-rt-exceptions-impl.c");\n            if exceptions.is_file() {\n                args.push(exceptions.display().to_string());\n            }');
}
export async function applyWasm2cExceptions(root) {
 const path=join(root,'adapters/native/src/aot.rs');
 const before=await readFile(path,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(before===null)return;
 const after=withWasm2cExceptions(before);
 if(after!==before){await writeFile(path+'.before-exception-runtime',before);await writeFile(path,after);}
}
