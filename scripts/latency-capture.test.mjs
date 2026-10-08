import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectLatencies,summarizeLatencies,latencyIdentity} from './lib/latency-capture.mjs';
const workload={id:'applications/test',artifact:'/cache/artifacts/test.wasm',artifactName:'test.wasm',sha256:'a'.repeat(64),abi:'core',export:'benchmark',args:['7']};
const manifest={host:{os:'linux',arch:'amd64',cpu_description:'Fixture CPU',logical_cpus:4,kernel:'fixture'},lock:{runtime_configurations:[{id:'engine',description:{runtime_version:'1.0',backend:'compiler'}}]}};
const trial=(block,values,status='ok')=>({id:'trial-'+block,block,profile:'timing',runtime_configuration:'engine',workload:workload.id,scenario:'steady',status,samples:values.map(n=>({elapsed_ns:n,operations:2,verified:true,warmup:false}))});
test('point estimate preserves the median-of-launch-medians and discards warmups, unverified samples, observations and evidence',()=>{
 const trials=[trial(0,[10,20,30]),trial(1,[80])];trials[0].samples.push({elapsed_ns:999,operations:1,verified:true,warmup:true},{elapsed_ns:888,operations:1,verified:false,warmup:false});
 const c=summarizeLatencies({manifest,trials,workloads:[workload],engines:['engine'],scenarios:['steady']});
 assert.equal(c.results[0].latencyNs,25);assert.equal(c.results[0].wasm,'test.wasm');assert.equal(c.results[0].latencyStatus,'ok');
 assert.deepEqual(Object.keys(c),['capturedAt','platform','results']);assert(!JSON.stringify(c).includes('samples'));assert(!JSON.stringify(c).includes('evidence'));
});
test('any failed launch or correctness check prevents a successful latency, while absent and unsupported results remain distinct',()=>{
 const summarize=trials=>summarizeLatencies({manifest,trials,workloads:[workload],engines:['engine'],scenarios:['steady']}).results[0];
 for(const failure of [trial(1,[],'failed'),{...trial(-1,[],'failed'),id:'check-0',scenario:'first-call'}]) {const row=summarize([trial(0,[10]),failure]);assert.equal(row.latencyStatus,'failed');assert.equal(row.latencyNs,null)}
 assert.equal(summarize([trial(0,[],'unsupported')]).latencyStatus,'unsupported');assert.equal(summarize([]).latencyStatus,'not-measured');
});
test('capture identity replaces repeated measurements but contract identities distinguish changed inputs',()=>{
 const c=summarizeLatencies({manifest,trials:[trial(0,[10])],workloads:[workload],engines:['engine'],scenarios:['steady']});
 const changed=summarizeLatencies({manifest,trials:[trial(0,[20])],workloads:[{...workload,args:['8']}],engines:['engine'],scenarios:['steady']});
 assert.equal(latencyIdentity(c),latencyIdentity(changed));assert.notEqual(c.results[0].contractSha256,changed.results[0].contractSha256);
});
test('default collector executes one timing pass and leaves no reports, tools, or trial evidence behind',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'latency-capture-'));const commands=[];
 try {
  await writeFile(join(directory,'wago-suite.json'),JSON.stringify([workload]));
  const capture=await collectLatencies({directory,workloads:[workload],engines:['engine'],collection:{timeout:'1s',launches:1,samples:3,operations:1,warmup:3},run:async(command,...args)=>{
   commands.push([command,...args]);assert.equal(command,'run');const out=args[args.indexOf('--out')+1];await mkdir(join(out,'trials'),{recursive:true});await writeFile(join(out,'manifest.json'),JSON.stringify(manifest));
   for(const scenario of ['compile','instantiate','first-call','steady'])await writeFile(join(out,'trials',scenario+'.json'),JSON.stringify({...trial(0,[10,20,30]),scenario}));
  }});
  assert.equal(commands.length,1);assert(commands[0].includes('--archive-tools=false'));assert(commands[0].includes('--timing-peak-rss=false'));assert.equal(capture.results.length,4);
  assert.deepEqual(await readdir(directory),['wago-suite.json']);
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('resource capture reuses kernel RSS from timing and executes only one extra cold code pass',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'resource-capture-'));const commands=[];
 try {
  await writeFile(join(directory,'wago-suite.json'),JSON.stringify([workload]));
  const capture=await collectLatencies({directory,workloads:[workload],engines:['engine'],collection:{memory:true,code:true,timeout:'1s',launches:2,samples:3,scenarioSamples:{compile:3},operations:7,warmup:3},run:async(command,...args)=>{
   commands.push([command,...args]);assert.equal(command,'run');
   const profile=args[args.indexOf('--profile')+1],out=args[args.indexOf('--out')+1];
   await mkdir(join(out,'trials'),{recursive:true});await writeFile(join(out,'manifest.json'),JSON.stringify(manifest));
   if(profile!=='timing') {
    for(const flag of ['--samples','--launches','--operations'])assert.equal(args[args.indexOf(flag)+1],'1');
    assert.equal(args[args.indexOf('--warmup')+1],'0');assert.equal(args[args.indexOf('--samples-by-scenario')+1],'{"*":1}');
   }
   for(const scenario of args[args.indexOf('--scenarios')+1].split(',')) {
    const t={...trial(0,[10,20,30]),profile,scenario};
    if(profile==='timing')t.observations=[{metric:'process.peak_rss',status:'available',value:4096}];
    if(profile==='code')t.code_image={data:Buffer.from('native').toString('base64')};
    await writeFile(join(out,'trials',scenario+'.json'),JSON.stringify(t));
   }
  }});
  assert.deepEqual(commands.map(c=>c[c.indexOf('--profile')+1]),['timing','code']);
  assert.equal(commands[1][commands[1].indexOf('--scenarios')+1],'compile');assert(commands[0].includes('--timing-peak-rss=true'));assert(commands[1].includes('--timing-peak-rss=false'));
  for(const row of capture.results){assert.equal(row.peakRssBytes,4096);assert.equal(row.memoryStatus,'ok');assert.equal(row.codeBytes,6);assert.equal(row.codeStatus,'ok')}
  assert.deepEqual(await readdir(directory),['wago-suite.json']);assert(!JSON.stringify(capture).includes('code_image'));
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('resource failures and unavailable code sizes remain separate from valid latency',()=>{
 const memory={...trial(0,[],'failed'),profile:'memory'};
 const code={...trial(0,[]),profile:'code',scenario:'compile',observations:[{metric:'native.code_size',status:'available',value:73}]};
 const row=summarizeLatencies({manifest,trials:[trial(0,[10]),memory,code],workloads:[workload],engines:['engine'],scenarios:['steady']}).results[0];
 assert.equal(row.latencyStatus,'ok');assert.equal(row.latencyNs,5);assert.equal(row.memoryStatus,'failed');assert.equal(row.peakRssBytes,null);assert.equal(row.codeBytes,73);
 code.observations=[];
 const missing=summarizeLatencies({manifest,trials:[trial(0,[10]),code],workloads:[workload],engines:['engine'],scenarios:['steady']}).results[0];
 assert.equal(missing.codeStatus,'unsupported');assert.equal(missing.codeBytes,null);
});

test('code-size definitions retain their meaning and full images take precedence over size estimates',()=>{
 const code={...trial(0,[]),profile:'code',scenario:'compile',observations:[{metric:'native.code_size',status:'available',value:9999}],code_image:{data:Buffer.from('native').toString('base64')}};
 const summarize=trials=>summarizeLatencies({manifest,trials:[trial(0,[10]),...trials],workloads:[workload],engines:['engine'],scenarios:['steady']}).results[0];
 const native=summarize([code]);assert.equal(native.codeKind,'native-image');assert.equal(native.codeBytes,6);
 delete code.code_image;
 const reported=summarize([code]);assert.equal(reported.codeKind,'engine-reported');assert.equal(reported.codeBytes,9999);
 const mixed=summarize([code,{...code,code_image:{data:Buffer.from('native').toString('base64')}}]);assert.equal(mixed.codeStatus,'failed');assert.equal(mixed.codeBytes,null);assert.equal(mixed.codeKind,null);
});

test('transpiler compilation memory is max of translator and compiler, excluding adapter RSS',()=>{
 const t={...trial(0,[10]),scenario:'compile',observations:[{metric:'process.peak_rss',status:'available',value:9000}]};
 t.samples[0].observations=[{metric:'aot.transpile.peak_rss',status:'available',value:2000},{metric:'aot.native_compile.peak_rss',status:'available',value:3000}];
 const row=summarizeLatencies({manifest,trials:[t],workloads:[workload],engines:['engine'],scenarios:['compile']}).results[0];
 assert.equal(row.peakRssBytes,3000);
});

test('peak RSS retains the maximum across measured trials',()=>{
 const trials=[1000,5000,2000].map(value=>({...trial(0,[10]),observations:[{metric:'process.peak_rss',status:'available',value}]}));
 assert.equal(summarizeLatencies({manifest,trials,workloads:[workload],engines:['engine'],scenarios:['steady']}).results[0].peakRssBytes,5000);
});
test('interpreter native code is unavailable without an extra compile pass',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'interpreter-capture-'));let passes=0;
 const interpreted=structuredClone(manifest);interpreted.lock.runtime_configurations[0].description.backend='interpreter';
 try{
  await writeFile(join(directory,'wago-suite.json'),'[]');
  const capture=await collectLatencies({directory,workloads:[workload],engines:['engine'],collection:{code:true,timeout:'1s',scenarios:'steady',launches:1,samples:1,operations:1,warmup:0},run:async(command,...args)=>{
   passes++;assert.equal(args[args.indexOf('--profile')+1],'timing');const out=args[args.indexOf('--out')+1];await mkdir(join(out,'trials'),{recursive:true});await writeFile(join(out,'manifest.json'),JSON.stringify(interpreted));await writeFile(join(out,'trials','steady.json'),JSON.stringify(trial(0,[10])));
  }});
  assert.equal(passes,1);assert.equal(capture.results[0].codeStatus,'unsupported');assert.equal(capture.results[0].codeBytes,null);
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('already compiled native code size avoids a duplicate transpiler/compiler pass',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'compiled-code-capture-'));let passes=0;
 try{
  await writeFile(join(directory,'wago-suite.json'),'[]');
  const capture=await collectLatencies({directory,workloads:[workload],engines:['engine'],collection:{code:true,timeout:'1s',scenarios:'compile,steady',launches:1,samples:1,operations:1,warmup:0},run:async(command,...args)=>{
   passes++;assert.equal(args[args.indexOf('--profile')+1],'timing');const out=args[args.indexOf('--out')+1];await mkdir(join(out,'trials'),{recursive:true});await writeFile(join(out,'manifest.json'),JSON.stringify(manifest));
   for(const scenario of ['compile','steady']){const t={...trial(0,[10]),scenario};if(scenario==='compile')t.samples[0].observations=[{metric:'native.code_size',status:'available',value:1234}];await writeFile(join(out,'trials',scenario+'.json'),JSON.stringify(t));}
  }});
  assert.equal(passes,1);assert(capture.results.every(r=>r.codeStatus==='ok'&&r.codeBytes===1234&&r.codeKind==='engine-reported'));
 }finally{await rm(directory,{recursive:true,force:true})}
});
