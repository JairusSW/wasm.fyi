import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readlink,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {reuseActiveHistorySDKs} from './reuse-active-history-sdks.mjs';
test('shares a sealed two-backend SDK while preserving per-job identity and existing work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'history-reuse-'));
 try {
  const pin={engine:'wasmtime',targetType:'release',tag:'v49.0.2',targetWeek:'2026-10-02',status:'planned',configurations:['wasmtime','wasmtime-winch']};
  const original=join(root,'engine-builds','wasmtime-v49.0.2-release-2026-10-02'),harness=join(original,'harness');
  await mkdir(join(harness,'adapters/wasmtime/target/release'),{recursive:true});await writeFile(join(harness,'adapters/wasmtime/Cargo.toml'),'features=["cranelift","winch"]');await writeFile(join(harness,'adapters/wasmtime/target/release/adapter-wasmtime'),'qualified binary');
  await writeFile(join(original,'binding.json'),JSON.stringify({release:pin,configuration:'wasmtime',environment:{}}));
  const absent={...pin,tag:'v49.0.1'};await writeFile(join(root,'source-plan.json'),JSON.stringify({pins:[pin,absent]}));
  assert.equal((await reuseActiveHistorySDKs(root)).reused,1);
  const alias=join(root,'engine-builds','wasmtime-winch-v49.0.2-release-2026-10-02');assert.equal(await readlink(join(alias,'harness')),harness);
  assert.equal(JSON.parse(await readFile(join(alias,'binding.json'))).configuration,'wasmtime-winch');
  assert.equal((await reuseActiveHistorySDKs(root)).reused,0);
  assert.equal((await readFile(join(harness,'adapters/wasmtime/target/release/adapter-wasmtime'),'utf8')),'qualified binary');
 }finally{await rm(root,{recursive:true,force:true})}
});
