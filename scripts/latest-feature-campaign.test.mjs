import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const execute=promisify(execFile);
// Darwin wraps the entire worker in a real device reservation. This fixture
// exercises the Linux orchestration path and never launches a runtime.
for(const [scope,phase] of [['execution','first-call'],['compile-only','compile'],['compile-and-instantiate','instantiate']])test('platform-unavailable '+scope+' binding records unsupported without invoking its controller',{skip:process.platform!=='linux'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'feature-unavailable-'));
 try{
  const inputs=join(root,'inputs'),output=join(root,'features'),harness=join(root,'harness');
  await mkdir(inputs);await mkdir(harness);
  const artifact=Buffer.from([0,97,115,109,1,0,0,0]),sha256=createHash('sha256').update(artifact).digest('hex');
  await writeFile(join(inputs,'empty.wasm'),artifact);
  const workload={id:'features/core-num/probe/1',artifact:'empty.wasm',sha256,abi:'core',export:'benchmark',args:[1],oracle:{kind:'exact_u64',expected:[0]},reset:'stateless',provenance:{scope}};
  for(const kind of ['compatibility','performance','compile','lifecycle'])await writeFile(join(inputs,kind+'.json'),JSON.stringify(kind==='compatibility'?[workload]:[]));
  const engine='unavailable-fixture',revision='a'.repeat(40),anchor='2026-10-15T07:33:48.082Z';
  await writeFile(join(root,'source-plan.json'),JSON.stringify({anchor,pins:[{engine,targetType:'main',repository:'fixture/fixture',targetWeek:anchor,status:'planned',revision,configurations:[engine]}]}));
  await writeFile(join(root,'collection-template.json'),JSON.stringify({env:{},platformSpecs:{cores:8,memoryBytes:1024}}));
  await writeFile(join(inputs,'identity.json'),JSON.stringify({fixture:'immutable inputs'}));
  const expectedPath=join(root,'reuse-contracts.json');
  await execute(process.execPath,[new URL('./export-feature-reuse.mjs',import.meta.url).pathname,root,inputs,expectedPath]);
  const expected=JSON.parse(await readFile(expectedPath,'utf8'));
  const controller=join(root,'controller'),called=join(root,'controller-was-called');
  await writeFile(controller,'#!/bin/sh\ntouch "'+called+'"\nexit 1\n',{mode:0o755});
  const bindings=join(root,'bindings.json');
  await writeFile(bindings,JSON.stringify([{engine,plan:{env:{}},job:{engine,harness,controller,source:{revision,asOf:anchor,repository:'fixture/fixture',ref:'main@aaaaaaaa',kind:'snapshot'},unavailableReason:'Pinned backend supports another architecture only'}}]));
  await execute(process.execPath,[new URL('./latest-feature-campaign.mjs',import.meta.url).pathname,root,output,inputs,bindings],{env:{...process.env,WASMFYI_FEATURE_ENGINES:engine}});
  assert.equal(await stat(called).catch(()=>null),null);
  const files=await readdir(join(root,'captures'));assert.equal(files.length,1);
  assert.ok(files[0].includes(expected.targets[0].keys[0]),'Exporter and running feature worker disagree on capture identity');
  const capture=JSON.parse(await readFile(join(root,'captures',files[0]),'utf8'));
  assert.equal(capture.source.revision,revision);assert.equal(capture.platform.cores,8);
  assert.deepEqual(capture.results.map(r=>[r.phase,r.latencyStatus,r.latencyNs,r.timingSamples]),[[phase,'unsupported',null,0]]);
  assert.equal(JSON.parse(await readFile(join(output,'status.json'),'utf8')).status,'completed');
 }finally{await rm(root,{recursive:true,force:true})}
});

test('explicit feature pins can advance beyond the frozen history plan',{skip:process.platform!=='linux'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'feature-pin-'));
 try{
  const inputs=join(root,'inputs'),output=join(root,'features'),harness=join(root,'harness');
  await mkdir(inputs);await mkdir(harness);
  for(const kind of ['compatibility','performance','compile','lifecycle'])await writeFile(join(inputs,kind+'.json'),'[]');
  const engine='pin-fixture',oldRevision='a'.repeat(40),revision='b'.repeat(40),oldAnchor='2026-10-01T00:00:00.000Z',anchor='2026-10-20T00:00:00.000Z';
  await writeFile(join(root,'source-plan.json'),JSON.stringify({pins:[{engine:'fixture',configurations:[engine],status:'planned',revision:oldRevision,targetWeek:oldAnchor}]}));
  await writeFile(join(root,'collection-template.json'),JSON.stringify({env:{},platformSpecs:{cores:8,memoryBytes:1024}}));
  const pins=join(root,'pins.json');
  await writeFile(pins,JSON.stringify({pins:[{engine:'fixture',configurations:[engine],status:'planned',revision,targetWeek:anchor}]}));
  const controller=join(root,'controller');await writeFile(controller,'#!/bin/sh\nexit 1\n',{mode:0o755});
  const bindings=join(root,'bindings.json');
  await writeFile(bindings,JSON.stringify([{engine,plan:{env:{}},job:{engine,harness,controller,source:{revision,asOf:anchor,repository:'fixture/fixture',ref:'main@bbbbbbbb',kind:'snapshot'},unavailableReason:'fixture unavailable'}}]));
  await execute(process.execPath,[new URL('./latest-feature-campaign.mjs',import.meta.url).pathname,root,output,inputs,bindings],{env:{...process.env,WASMFYI_FEATURE_ENGINES:engine,WASMFYI_FEATURE_PINS_FILE:pins}});
  const status=JSON.parse(await readFile(join(output,'status.json'),'utf8'));
  assert.deepEqual(status.errors,[]);assert.equal(status.status,'completed');
 }finally{await rm(root,{recursive:true,force:true})}
});
