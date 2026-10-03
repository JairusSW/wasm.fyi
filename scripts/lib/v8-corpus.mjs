import { readFile, mkdtemp, writeFile, open, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { WASI } from 'node:wasi';
import { digest } from './wasmbench.mjs';

// Read parameter types so decimal-string i64 values never pass through Number.
export function parameterTypes(bytes, name) {
  let p=8;
  const u=()=>{let n=0,shift=0,b;do {b=bytes[p++];n+=(b&127)*2**shift;shift+=7;}while(b&128);return n;};
  const text=()=>{const length=u(),s=bytes.subarray(p,p+length).toString();p+=length;return s;};
  const types=[],functions=[];let exported;
  while(p<bytes.length) {
    const section=bytes[p++],length=u(),end=p+length;
    if(section===1)for(let n=u();n--;){
      if(bytes[p++]!==0x60)return null; // GC type groups use i32 fixture args.
      const params=[];for(let count=u();count--;)params.push(bytes[p++]);
      for(let count=u();count--;)p++;
      types.push(params);
    }
    if(section===2)for(let n=u();n--;){text();text();const kind=bytes[p++];if(kind===0)functions.push(u());
      else if(kind===1){p++;const flags=u();u();if(flags&1)u();}
      else if(kind===2){const flags=u();u();if(flags&1)u();}
      else if(kind===3){p+=2;}
      else if(kind===4){u();u();}
      else return null;}
    if(section===3)for(let n=u();n--;)functions.push(u());
    if(section===7)for(let n=u();n--;){const label=text(),kind=bytes[p++],index=u();if(label===name&&kind===0)exported=index;}
    p=end;
  }
  return types[functions[exported]] || null;
}

export async function checkV8(w, { repeat=3, mutateImports, afterInstantiate, root }={}) {
  const bytes=await readFile(w.artifact);
  if(digest(bytes)!==w.sha256)throw Error('Artifact digest mismatch: '+w.id);
  if(w.abi==='component')return {status:'unavailable',reason:'V8 does not expose native Component Model execution; check with Wasmtime'};
  if(w.abi==='emscripten')return {status:'unavailable',reason:'Emscripten host glue required; excluded from portable corpus'};
  if(!['core','wasi-command'].includes(w.abi))throw Error('Unknown ABI: '+w.abi);
  if(!['stateless','fresh_instance_per_sample'].includes(w.reset))throw Error('Unknown reset policy: '+w.reset);
  const options=w.host_profile==='js-string-builtins-v1'?{builtins:['js-string'],importedStringConstants:'strings'}:{};
  let module;
  try { module=await WebAssembly.compile(bytes,options); }
  catch(error) { if(!(error instanceof WebAssembly.CompileError))throw error;return {status:'unavailable',reason:String(error.message)}; }
  for(let run=0;run<repeat;run++) {
    if(w.abi==='wasi-command') {
      const dir=await mkdtemp(join(tmpdir(),'wasm-fyi-v8-wasi-'));const handles=[];
      try {
        const contract=w.command;
        if(!contract||w.oracle.kind!=='exact_command')throw Error('Missing exact command contract: '+w.id);
        const fixtures=join(dir,'fixtures');await mkdir(fixtures);
        for(const [name,item] of Object.entries(contract.files || {})) {
          const path=resolve(fixtures,name);
          if(!path.startsWith(fixtures+'/'))throw Error('Unsafe command input path');
          const data=item.path?await readFile(resolve(root || '.',item.path)):Buffer.from(item.data || '', 'base64');
          if(digest(data)!==item.sha256)throw Error('Command input digest mismatch: '+name);
          await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,data);
        }
        const stdin=contract.stdin_file?await readFile(join(fixtures,contract.stdin_file)):Buffer.from(contract.stdin || '', 'base64');
        await writeFile(join(dir,'stdin'),stdin);
        for(const [name,flags] of [['stdin','r'],['stdout','w+'],['stderr','w+']])handles.push(await open(join(dir,name),flags));
        const preopens=Object.keys(contract.files || {}).length?{'/':fixtures}:{};
        for(const item of contract.preopens || []) {
          const path=resolve(root || '.',item.host_path);
          preopens[item.guest_path]=path;
        }
        const wasi=new WASI({version:'preview1',args:contract.argv,env:{LANG:'C.UTF-8',...contract.env},preopens,
          stdin:handles[0].fd,stdout:handles[1].fd,stderr:handles[2].fd,returnOnExit:true});
        const imports=wasi.getImportObject();mutateImports?.(imports);
        const instance=await WebAssembly.instantiate(module,imports);
        afterInstantiate?.(instance);
        const exit=wasi.start(instance);
        if(exit!==contract.exit_code)throw Error(`Incorrect exit ${w.id}: ${exit}: ${await readFile(join(dir,'stderr'),'utf8')} stdout=${(await readFile(join(dir,'stdout'),'utf8')).slice(0,500)}`);
        for(const name of ['stdout','stderr']) {
          const output=await readFile(join(dir,name));
          if(output.length>contract.output_limit_bytes||(contract[name+'_sha256']&&digest(name==='stdout'?normalizeStdout(output,contract.stdout_normalize):output)!==contract[name+'_sha256']))throw Error(`Incorrect ${name}: ${w.id}: ${output.toString().slice(0,1000)}`);
        }
      } finally {await Promise.all(handles.map(h=>h.close().catch(error=>{if(error.code!=='EBADF')throw error;})));await rm(dir,{recursive:true,force:true});}
    } else {
      const imports=Object.create(null);
      if(w.host_profile==='assemblyscript-abort-v1')imports.env={abort:()=>{throw Error('AssemblyScript abort');}};
      if(w.host_profile==='identity-v1')imports.wasmbench={identity:v=>v};
      const instance=await WebAssembly.instantiate(module,imports);
      const params=parameterTypes(bytes,w.export);
      if(params&&!w.vectors&&params.length!==w.args.length)throw Error('Incorrect argument count: '+w.id);
      const args=w.args.map((value,i)=>params?.[i]===0x7e?BigInt(value):Number(value));
      if(w.initialize)instance.exports[w.initialize]();
      if(w.input) {
        const base=w.input.pointer_export?Number(instance.exports[w.input.pointer_export]())>>>0:0;
        new Uint8Array(instance.exports.memory.buffer,base+w.input.offset,w.input.hex.length/2).set(Buffer.from(w.input.hex,'hex'));
      }
      if(w.vectors) {
        const v=w.vectors;
        const input=v.input_ptr_export?instance.exports[v.input_ptr_export]()>>>0:v.input_offset;
        const output=v.output_ptr_export?instance.exports[v.output_ptr_export]()>>>0:v.output_offset;
        for(const c of v.cases) {
          new Uint8Array(instance.exports.memory.buffer,input,c.len).set(Uint8Array.from({length:c.len},(_,i)=>i%v.mod));
          instance.exports[w.export](input,c.len,output);
          if(!Buffer.from(instance.exports.memory.buffer,output,v.output_len).equals(Buffer.from(c.out,'hex')))throw Error('Incorrect vector: '+w.id+'/'+c.len);
        }
        continue;
      }
      // A stateless contract must also survive calls on the same instance.
      for(let call=0;call<(w.reset==='stateless'?3:1);call++) {
        const value=instance.exports[w.export](...args);
        const result=(Array.isArray(value)?value:value===undefined?[]:[value]).map(x=>typeof x==='bigint'?BigInt.asUintN(64,x).toString():String(x>>>0));
        if(w.oracle.kind!=='exact_u64'||JSON.stringify(result)!==JSON.stringify(w.oracle.expected.map(String)))throw Error(`Incorrect result ${w.id}: ${result}`);
        const base=w.oracle.output_pointer_export?Number(instance.exports[w.oracle.output_pointer_export]())>>>0:0;
        for(const check of w.oracle.memory || [])if(!Buffer.from(instance.exports.memory.buffer,base+check.offset,check.hex.length/2).equals(Buffer.from(check.hex,'hex')))throw Error('Incorrect memory: '+w.id);
      }
    }
  }
  return {status:'verified',repetitions:repeat};
}

function normalizeStdout(bytes, policy) {
  if(!policy)return bytes;
  if(policy==='llvm-ir-preds')return Buffer.from(bytes.toString().replace(/ +; preds =/g,' ; preds ='));
  throw Error('Unknown stdout normalization: '+policy);
}
