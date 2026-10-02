import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRecoveryCohort} from './lib/collection-recovery.mjs';
test('recovery permits archive relocation but rejects changed inputs and oracles',()=>{
 const original=[{id:'command',artifact:'artifacts/a.wasm',sha256:'a'.repeat(64),abi:'wasi',command:{files:{input:{path:'inputs/b',sha256:'b'.repeat(64),size:12}},stdout_sha256:'c'.repeat(64)},oracle:{kind:'exact_command'},reset:'fresh_instance_per_sample'}];
 const relocated=structuredClone(original);relocated[0].artifact='/source/a.wasm';relocated[0].command.files.input.path='/source/input';
 assertRecoveryCohort(relocated,original);
 for(const mutate of [w=>w.command.files.input.sha256='d'.repeat(64),w=>w.command.stdout_sha256='e'.repeat(64),w=>w.abi='core',w=>w.reset='retained']) {
  const changed=structuredClone(relocated);mutate(changed[0]);assert.throws(()=>assertRecoveryCohort(changed,original));
 }
 assert.throws(()=>assertRecoveryCohort([...relocated,...relocated],original),/Duplicate/);
});
