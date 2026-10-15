import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectLatencies,latencyCollection} from './lib/latency-capture.mjs';
import {samplePolicy} from './lib/sample-stability.mjs';

test('default collector uses the hardcoded grouped policy',()=>assert.deepEqual(latencyCollection({}).adaptiveSampling,samplePolicy));

test('one timing process per phase retains acquisition order, trimming metadata and resources',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'grouped-capture-'));
 const workload={id:'applications/grouped-test',artifact:'/test.wasm',sha256:'a'.repeat(64),abi:'core',export:'benchmark',args:['7']};
 const commands=[];
 try{
  await writeFile(join(directory,'wago-suite.json'),JSON.stringify([workload]));
  const capture=await collectLatencies({directory,workloads:[workload],engines:['a'],collection:{adaptiveSampling:samplePolicy,timeout:'5m',operations:1,memory:true,code:true},run:async(command,...args)=>{
   assert.equal(command,'run');commands.push(args);
   const get=flag=>args[args.indexOf(flag)+1],out=get('--out'),profile=get('--profile');
   await mkdir(join(out,'trials'),{recursive:true});
   await writeFile(join(out,'manifest.json'),JSON.stringify({host:{os:'linux',arch:'amd64',cpu_description:'Fixture',logical_cpus:1},lock:{runtime_configurations:[{id:'a',description:{runtime_version:'1',backend:'jit'}}]}}));
   assert.equal(get('--launches'),'1');assert.equal(get('--warmup'),'0');
   if(profile==='timing'){assert(args.includes('--adaptive-samples'));assert.equal(get('--samples'),'5');}
   for(const phase of get('--scenarios').split(',')){
    const values=profile==='code'?[100]:phase==='steady'?[300,250,200,150,130,...Array(10).fill(100)]:Array(5).fill(100);
    const row={runtime_configuration:'a',workload:workload.id,scenario:phase,profile,block:0,status:'ok',samples:values.map((value,index)=>({index,elapsed_ns:value,operations:1,verified:true,warmup:false})),observations:[{metric:profile==='code'?'native.code_size':'process.peak_rss',status:'available',value:profile==='code'?77:1000}]};
    await writeFile(join(out,'trials',phase+'.json'),JSON.stringify(row));
   }
  }});
  assert.equal(commands.length,2,'one combined timing capture and one native-code capture');
  for(const row of capture.results){assert.equal(row.latencyNs,100);assert.equal(row.peakRssBytes,1000);assert.equal(row.codeBytes,77);assert.equal(row.sampling.warmup,0);}
  const steady=capture.results.find(r=>r.phase==='steady');assert.equal(steady.timingSamples,15);assert.equal(steady.sampling.retainedStart,5);assert.equal(steady.samplesNs[0],300);
  assert.equal(JSON.parse(await readFile(join(directory,'sampling.json'))).method,'same-process-stability-v1');
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('feature batches override steady work without multiplying compilation or first-call work',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'feature-batches-'));
 const workload={id:'features/numeric/add/performance-4096x64',artifact:'/test.wasm',sha256:'a'.repeat(64),provenance:{performance:true}};
 try{
  await writeFile(join(directory,'wago-suite.json'),JSON.stringify([workload]));
  const capture=await collectLatencies({directory,workloads:[workload],engines:['v8'],collection:latencyCollection({timeout:'5m',operations:1,steadyOperations:8,memory:false,code:false}),run:async(command,...args)=>{
   const get=flag=>args[args.indexOf(flag)+1],out=get('--out');
   assert.equal(get('--operations'),'1');assert.equal(get('--steady-operations'),'8');
   assert.equal(get('--launches'),'1');assert.equal(get('--warmup'),'0');
   await mkdir(join(out,'trials'),{recursive:true});
   await writeFile(join(out,'manifest.json'),JSON.stringify({host:{os:'darwin',arch:'arm64',cpu_description:'Fixture',logical_cpus:1},lock:{runtime_configurations:[{id:'v8',description:{runtime_version:'1',backend:'turboshaft',capabilities:{can_code_profile:false}}}]}}));
   for(const phase of get('--scenarios').split(',')){
    const operations=phase==='steady'?8:1;
    await writeFile(join(out,'trials',phase+'.json'),JSON.stringify({runtime_configuration:'v8',workload:workload.id,scenario:phase,profile:'timing',block:0,status:'ok',samples:Array.from({length:5},(_,index)=>({index,elapsed_ns:1000*operations,operations,verified:true,warmup:false})),observations:[{metric:'process.peak_rss',status:'available',value:1000}]}));
   }
  }});
  assert(capture.results.every(r=>r.latencyNs===1000&&r.samplesNs.length===5));
 }finally{await rm(directory,{recursive:true,force:true})}
});
