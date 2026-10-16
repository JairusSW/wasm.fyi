import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('actual AOT bridge compiles against legacy w2c2 generated instance declarations',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wasmfyi-aot-bridge-'));
 try {
  const bridge=await readFile(new URL('../adapters/qualification/aot_bridge.rs',import.meta.url),'utf8');
  const program=`#![allow(dead_code)]
#[derive(Clone,Copy)] enum ValType { I32,I64 }
struct Export { name:String,symbol:String,params:Vec<ValType>,results:Vec<ValType> }
${bridge}
fn main(){let header=std::fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap();print!("{}",bridge(false,&[],&None,false,false,&header));}
`;
  await writeFile(join(directory,'probe.rs'),program);
  await writeFile(join(directory,'wb.h'),'typedef struct wbInstance { int unused; } wbInstance;\ntypedef int Trap;\nconst char* trapDescription(Trap);\nvoid wbInstantiate(wbInstance*,void*);\nvoid wbFreeInstance(wbInstance*);\n');
  const rust=spawnSync(process.env.RUSTC||'rustc',['--edition=2024',join(directory,'probe.rs'),'-o',join(directory,'probe')],{encoding:'utf8',timeout:60000});
  assert.equal(rust.status,0,rust.error?.message||rust.stderr);
  const generated=spawnSync(join(directory,'probe'),[join(directory,'wb.h')],{encoding:'utf8',timeout:5000});
  assert.equal(generated.status,0,generated.stderr);
  await writeFile(join(directory,'bridge.c'),generated.stdout);
  const native=spawnSync(process.env.CC||'cc',['-std=c11','-Werror=implicit-function-declaration','-fsyntax-only',join(directory,'bridge.c')],{encoding:'utf8',timeout:15000});
  assert.equal(native.status,0,native.error?.message||native.stderr);
 }finally {await rm(directory,{recursive:true,force:true});}
});
