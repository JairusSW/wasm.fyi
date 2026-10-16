import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

async function checkBridge({legacy,exports=false}) {
 const directory=await mkdtemp(join(tmpdir(),'wasmfyi-aot-bridge-'));
 try {
  const bridge=await readFile(new URL('../adapters/qualification/aot_bridge.rs',import.meta.url),'utf8');
  const program=`#![allow(dead_code)]
#[derive(Clone,Copy)] enum ValType { I32,I64 }
struct Export { name:String,symbol:String,params:Vec<ValType>,results:Vec<ValType> }
${bridge}
fn main(){
 let header=std::fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap();
 let exports=${exports?'vec![Export{name:"add".into(),symbol:w2c2_export_symbol(&header,"add"),params:vec![ValType::I32,ValType::I32],results:vec![ValType::I32]},Export{name:"X__value".into(),symbol:w2c2_export_symbol(&header,"X__value"),params:vec![],results:vec![ValType::I32]},Export{name:"new".into(),symbol:w2c2_export_symbol(&header,"new"),params:vec![],results:vec![ValType::I32]},Export{name:"call".into(),symbol:w2c2_export_symbol(&header,"call"),params:vec![],results:vec![ValType::I32]}]':'vec![]'};
 let memory=${exports?'Some(w2c2_export_symbol(&header,"memory"))':'None'};
 print!("{}",bridge(false,&exports,&memory,${exports},${exports},&header));
}
`;
  await writeFile(join(directory,'probe.rs'),program);
  const instance=legacy?'wbInstance':'m2_wbInstance';
  const prefix=legacy?'wb':'m2_wb';
  const declarations=exports?(legacy?
   'U32 wb_add(wbInstance*,U32,U32);\nU32 wb_X58___value(wbInstance*);\nU32 wb_new(wbInstance*);\nU32 wb_call(wbInstance*);\nwasmMemory* wb_memory(wbInstance*);\nU32 wasmbench__identity(wasmModuleInstance*,U32);\nvoid env__abort(wasmModuleInstance*,U32,U32,U32,U32);\n':
   'U32 m2_wbExport3_add(m2_wbInstance*,U32,U32);\nU32 m2_wbExport8_X58X5FX5Fvalue(m2_wbInstance*);\nU32 m2_wbExport3_new(m2_wbInstance*);\nU32 m2_wbExport4_call(m2_wbInstance*);\nwasmMemory* m2_wbExport6_memory(m2_wbInstance*);\nU32 i9_wasmbench8_identity(wasmModuleInstance*,U32);\nvoid i3_env5_abort(wasmModuleInstance*,U32,U32,U32,U32);\n'):'';
  await writeFile(join(directory,'wb.h'),`#include <stdint.h>
typedef uint32_t U32;typedef uint64_t U64;
typedef struct wasmModuleInstance { int unused; } wasmModuleInstance;
typedef struct ${instance} { wasmModuleInstance common; } ${instance};
typedef struct wasmMemory { U32 pages;unsigned char* data; } wasmMemory;
typedef int Trap;
const char* trapDescription(Trap);
void ${prefix}Instantiate(${instance}*,void*);
void ${prefix}FreeInstance(${instance}*);
${declarations}`);
  const rust=spawnSync(process.env.RUSTC||'rustc',['--edition=2024',join(directory,'probe.rs'),'-o',join(directory,'probe')],{encoding:'utf8',timeout:60000});
  assert.equal(rust.status,0,rust.error?.message||rust.stderr);
  const generated=spawnSync(join(directory,'probe'),[join(directory,'wb.h')],{encoding:'utf8',timeout:5000});
  assert.equal(generated.status,0,generated.stderr);
  await writeFile(join(directory,'bridge.c'),generated.stdout);
  const native=spawnSync(process.env.CC||'cc',['-std=c11','-Werror=implicit-function-declaration','-fsyntax-only',join(directory,'bridge.c')],{encoding:'utf8',timeout:15000});
  assert.equal(native.status,0,native.error?.message||native.stderr);
 }finally {await rm(directory,{recursive:true,force:true});}
}

test('actual AOT bridge compiles against legacy w2c2 generated instance declarations',()=>checkBridge({legacy:true}));
test('modern w2c2 exports, escape sequences, memory and host imports compile',()=>checkBridge({legacy:false,exports:true}));
test('legacy w2c2 exports, escape sequences, memory and host imports compile',()=>checkBridge({legacy:true,exports:true}));
