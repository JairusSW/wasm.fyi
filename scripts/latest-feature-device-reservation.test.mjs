import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';

const execute=promisify(execFile);
test('Darwin feature worker launches exactly one device wrapper without holding a project lock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'feature-device-order-'));
 try{
  const entry=new URL('./latest-feature-campaign.mjs',import.meta.url),staged=join(root,'worker.mjs'),argumentsPath=join(root,'arguments.txt');
  const source=(await readFile(entry,'utf8')).replace(/from\s*(['"])(\.[^'"]+)\1/g,(_match,_quote,path)=>'from '+JSON.stringify(new URL(path,entry).href));
  await writeFile(staged,source);
  // Intercept only Python execution. Keep the real command helper, which can
  // add its own reservation; mocking that helper hid a nested-wrapper bug.
  const python=join(root,'python3');await writeFile(python,'#!/bin/sh\nprintf "%s\\n" "$@" > "$WASMFYI_TEST_ARGUMENTS"\nif [ -d "$WASMFYI_TEST_CAMPAIGN/measurement-lock" ]; then printf "PROJECT_LOCK_HELD_BEFORE_DEVICE\\n" >> "$WASMFYI_TEST_ARGUMENTS"; fi\n',{mode:0o755});
  const campaign=join(root,'campaign');await mkdir(campaign);
  const launch=`Object.defineProperty(process,'platform',{value:'darwin'});delete process.env.WASMBENCH_SHARED_DEVICE_RESERVED;process.argv=${JSON.stringify([process.execPath,staged,campaign,join(root,'features'),join(root,'inputs')])};await import(${JSON.stringify(pathToFileURL(staged).href)})`;
  await execute(process.execPath,['--input-type=module','-e',launch],{env:{...process.env,PATH:root+':'+process.env.PATH,WASMFYI_TEST_ARGUMENTS:argumentsPath,WASMFYI_TEST_CAMPAIGN:campaign}});
  const args=(await readFile(argumentsPath,'utf8')).trim().split('\n');
  assert.equal(args.filter(arg=>arg.endsWith('/shared-device-run.py')).length,1,'A reservation coordinator must never be wrapped in another reservation');
  assert.equal(args.includes('python3'),false,'The wrapped command is the Node worker, not another reservation coordinator');
  assert.ok(!args.includes('PROJECT_LOCK_HELD_BEFORE_DEVICE'));
  assert.ok(args.includes('--repeat-slices'));
  assert.ok(args.includes('WASMBENCH_SHARED_DEVICE_RESERVED=1'));
  assert.ok(!args.includes('WASMBENCH_PROJECT_RESERVED=1'));
  assert.deepEqual(await readdir(campaign),[],'Waiting for the device must not leave a project reservation held');
 }finally{await rm(root,{recursive:true,force:true})}
});

for(const engine of ['fixture-engine','v8'])test(`reserved ${engine} worker yields without a capture when another SDK owns the project lock`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'feature-project-busy-'));let release;
 try{
  const campaign=join(root,'campaign'),output=join(root,'features'),inputs=join(root,'inputs'),harness=join(root,'harness');
  for(const path of [campaign,inputs,harness])await mkdir(path);
  const write=async(path,value)=>writeFile(path,JSON.stringify(value));
  const revision='a'.repeat(40),anchor='2026-10-15T07:33:48.082Z',source={repository:'fixture/fixture',revision,asOf:anchor,ref:'main@aaaaaaaa',kind:'snapshot'};
  await write(join(campaign,'source-plan.json'),{anchor,pins:[{engine,configurations:[engine],revision,targetWeek:anchor,status:'planned'}]});
  await write(join(campaign,'collection-template.json'),{env:{},platformSpecs:{cores:1,memoryBytes:1024}});
  const artifact=Buffer.from([0,97,115,109,1,0,0,0]);await writeFile(join(inputs,'fixture.wasm'),artifact);
  const workload={id:'features/core-num/fixture/1',artifact:'fixture.wasm',sha256:createHash('sha256').update(artifact).digest('hex'),abi:'core',export:'benchmark',args:[],oracle:{kind:'exact_u64',expected:['0']},reset:'stateless',provenance:{scope:'execution'}};
  for(const kind of ['compatibility','performance','compile','lifecycle'])await write(join(inputs,kind+'.json'),kind==='compatibility'?[workload]:[]);
  const controller=join(root,'controller');await writeFile(controller,'must never execute');
  const bindings=join(root,'bindings.json');await write(bindings,[{engine,plan:{env:{}},job:{engine,source,harness,controller}}]);
  if(engine==='v8'){const sdk=join(campaign,'sdk-builds','v8-fixture');await mkdir(sdk,{recursive:true});await write(join(sdk,'v8-build.json'),{pin:{revision}})}
  const runner=join(root,'runner.mjs');await writeFile(runner,`export function runCommand(){throw Error('No SDK may launch while the project is busy')}export function runBenchmarkProcess(){throw Error('No benchmark may launch while the project is busy')}`);
  const entry=new URL('./latest-feature-campaign.mjs',import.meta.url),staged=join(root,'worker.mjs');
  const text=(await readFile(entry,'utf8')).replace(/from\s*(['"])(\.[^'"]+)\1/g,(_match,_quote,path)=>'from '+JSON.stringify((path==='./lib/benchmark-process.mjs'?pathToFileURL(runner):new URL(path,entry)).href));
  await writeFile(staged,text);
  release=await acquireMeasurementLock(join(campaign,'measurement-lock'));
  const launch=`Object.defineProperty(process,'platform',{value:'darwin'});process.env.WASMBENCH_SHARED_DEVICE_RESERVED='1';delete process.env.WASMBENCH_PROJECT_RESERVED;process.argv=${JSON.stringify([process.execPath,staged,campaign,output,inputs,bindings])};await import(${JSON.stringify(pathToFileURL(staged).href)})`;
  const result=await execute(process.execPath,['--input-type=module','-e',launch],{env:{...process.env,WASMFYI_FEATURE_ENGINES:engine},timeout:4500,killSignal:'SIGKILL'}).then(value=>({...value,code:0}),error=>error);
  assert.equal(result.code,75,'The worker must release the device instead of waiting indefinitely behind an SDK');
  assert.equal(JSON.parse(await readFile(join(output,'status.json'),'utf8')).status,'waiting-host-lock');
  assert.equal((await readdir(join(campaign,'captures')).catch(()=>[])).length,0);
  assert.deepEqual(JSON.parse(await readFile(join(output,'ledger.json'),'utf8')).items,{});
  // A new worker can acquire the ledger immediately after the yield.
  const writer=await acquireMeasurementLock(join(output,'ledger-writer-lock'),AbortSignal.timeout(100));await writer();
 }finally{if(release)await release();await rm(root,{recursive:true,force:true})}
});
