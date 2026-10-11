// Share the already-qualified legacy core embedding across release and git builds.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
export async function applyLegacyWasmtimeAPI(root,major){
 const replace=async(path,old,value)=>{
  const file=join(root,path),source=await readFile(file,'utf8');
  if(!source.includes(old)){if(source.includes(value))return;throw Error('Legacy Wasmtime adapter anchor missing: '+path);}
  await writeFile(file,source.replaceAll(old,value));
 };
    let compatibilityPatch=null;
    if(major===24||major===36) {
      await replace('adapters/wasmtime/Cargo.toml','features = ["p1"]','features = ["preview1"]');
      if(major===24){
        const manifest=join(root,'adapters/wasmtime/Cargo.toml');
        await writeFile(manifest,(await readFile(manifest,'utf8')).replace(/wasmtime-internal-jit-icache-coherence = \{ (version|path)/,'wasmtime-internal-jit-icache-coherence = { package = "wasmtime-jit-icache-coherence", $1'));
        await replace('adapters/wasmtime/Cargo.toml','component-async-probes = ["wasmtime/component-model-async"]','component-async-probes = []');
        await replace('adapters/wasmtime/src/pooling.rs','.memory_reservation(16 * 1024 * 1024)','.static_memory_maximum_size(16 * 1024 * 1024)');
        await replace('adapters/wasmtime/src/pooling.rs','.memory_guard_size(65536)','.static_memory_guard_size(65536).dynamic_memory_guard_size(65536)');
        await replace('adapters/wasmtime/src/vectors.rs','Val::default_for_ty(&t)', 'match t { ValType::I32=>Some(Val::I32(0)), ValType::I64=>Some(Val::I64(0)), ValType::F32=>Some(Val::F32(0)), ValType::F64=>Some(Val::F64(0)), ValType::V128=>Some(Val::V128(0u128.into())), ValType::Ref(r) if r.is_nullable()=>Some(Val::null_ref(r.heap_type())), _=>None }');
      }
      const files=[];
      const patchOldApi=async directory=>{
        for(const entry of await readdir(join(root,directory),{withFileTypes:true})) {
          const path=join(directory,entry.name);
          if(entry.isDirectory())await patchOldApi(path);
          else if(path.endsWith('.rs')) {
            let text=await readFile(join(root,path),'utf8');
            text=text.replaceAll('wasmtime_wasi::p1','wasmtime_wasi::preview1').replaceAll('p1::{self','preview1::{self')
              .replaceAll('wasmtime::bail!','anyhow::bail!').replaceAll('wasmtime::ensure!','anyhow::ensure!')
              .replaceAll('wasmtime::format_err!','anyhow::anyhow!');
            text=text.replace(/use wasmtime::\{[^;]*\};/gs,clause=>clause
              .replace(/([,{])\s*(?:bail|ensure|format_err(?:\s+as\s+\w+)?)\s*,/g,'$1')
              .replace(/,\s*(?:bail|ensure|format_err(?:\s+as\s+\w+)?)\s*(?=})/g,'')
              .replace(/\{\s*}/g,'{}'));
            text=text.replace(/use wasmtime::(?:bail|ensure|format_err(?:\s+as\s+\w+)?)\s*;/g,'')
              .replace(/(?<!:)\bbail!/g,'anyhow::bail!').replace(/(?<!:)\bensure!/g,'anyhow::ensure!')
              .replace(/(?<!:)\bformat_err!/g,'anyhow::anyhow!').replace(/(?<![:\w])anyhow!/g,'anyhow::anyhow!')
              .replace('preview1::{self,','preview1::{self as p1,')
              .replace('use crate::{Result, Val, Value, anyhow, bail, bits};','use crate::{Result, Val, Value, bits};');
            await writeFile(join(root,path),text);files.push(path);
          }
        }
      };
      await patchOldApi('adapters/wasmtime/src');
      await writeFile(join(root,'adapters/wasmtime/src/features.rs'),
        'use serde_json::{Value,json};\nuse wasmtime::Config;\n'+
        'pub fn configure(config:&mut Config,winch:bool){config.wasm_tail_call(!winch);config.wasm_relaxed_simd(!winch);'+(major===24?'':'config.wasm_exceptions(false);config.wasm_legacy_exceptions(false);')+'if winch&&cfg!(target_arch="aarch64"){config.wasm_simd(false);}}\n'+
        'pub fn describe(winch:bool)->Value{json!({"namespace":"Wasmtime '+major+' Config defaults","enabled":{"TAIL_CALL":!winch,"RELAXED_SIMD":!winch,"SIMD":!(winch&&cfg!(target_arch="aarch64"))},"disabled":["GC","FUNCTION_REFERENCES","THREADS","STACK_SWITCHING","CM_ASYNC","CM_ASYNC_STACKFUL"]})}\n');
      await writeFile(join(root,'adapters/wasmtime/src/component_calls.rs'),
        'use serde_json::{Value,json};\nuse wasmtime::{Engine,Result};\n'+
        'pub const POLICY:&str="component-u64-v1";pub const BOUNDARIES:&str="not measured: features held";\n'+
        'pub fn validate(_: &Value)->Result<()>{Ok(())}\n'+
        'pub fn run(_: &Engine,_:&[u8],_:&Value,_:&Value,_:&mut dyn FnMut(u64,&str)->Result<()>)->Result<Value>{Ok(json!({"status":"unsupported","reason":"historical Component Model features held"}))}\n');
      await writeFile(join(root,'adapters/wasmtime/src/components.rs'),
        'use serde_json::{Value,json};\nuse wasmtime::{Engine,Result};\n'+
        'pub fn validate_workload(_: &Value)->Result<()>{Ok(())}\n'+
        'pub fn run(_: &Engine,_:&[u8],_:&Value,_:&Value)->Result<Value>{Ok(json!({"status":"unsupported","reason":"historical Component Model features held"}))}\n');
      compatibilityPatch={adapterApi:'Wasmtime '+major,wasiPreview1Feature:'preview1',components:'excluded from this feature-held suite',filesSha256:digest(JSON.stringify(await Promise.all(files.map(async path=>[path,digest(await readFile(join(root,path)))]))))};
    }
 return compatibilityPatch;
}
