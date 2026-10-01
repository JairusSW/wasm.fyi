import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { hostname, arch, platform, cpus } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { digest, site, harness, command } from './lib/wasmbench.mjs';
if (!isMainThread) {
  const {root}=await harness();
  const {verifyCompilerMode}=await import(pathToFileURL(join(root,'adapters/v8/compiler-mode.mjs')));
  const probe=verifyCompilerMode(workerData.compilerMode || 'optimizing-only');
  const instance = new WebAssembly.Instance(workerData.module, {env:{memory:workerData.memory}});
  parentPort.on('message', ({operations,address}) => { instance.exports.increment(operations,address); parentPort.postMessage('done'); });
  parentPort.postMessage({flags:process.execArgv,probe});
} else {
  const {root,settings}=await harness();
  const {compilerModeFlags,verifyCompilerMode,parseCompilerMode}=await import(pathToFileURL(join(root,'adapters/v8/compiler-mode.mjs')));
  if(process.argv.length===2) {
    const variants={},results=[];
    for(const mode of ['optimizing-only','liftoff-only']) {
      command(process.execPath,[...compilerModeFlags[mode],fileURLToPath(import.meta.url),'--compiler-mode='+mode],{stdio:'inherit'});
      const directory=join(site,'data/threads');
      const ref=JSON.parse(await readFile(join(directory,`${platform()}-${arch()}-${mode}.json`),'utf8'));
      const bytes=await readFile(join(directory,ref.evidence));
      if(digest(bytes)!==ref.sha256)throw new Error('Changed worker variant evidence');
      const raw=JSON.parse(bytes),{results:cases,...facts}=raw;
      variants[mode]=facts;results.push(...cases);
    }
    const first=variants['optimizing-only'],second=variants['liftoff-only'];
    for(const key of ['node','v8','artifactSha256','sourceSha256','collectorSha256','nodeExecutableSha256','compilerModeSourceSha256'])
      if(first[key]!==second[key])throw new Error('Worker variants do not share pinned inputs: '+key);
    const raw={...first,schema:2,created:new Date().toISOString(),configuration:'V8 Turboshaft-only and Liftoff-only / Node worker_threads / shared imported WebAssembly.Memory',variants,results};
    const bytes=JSON.stringify(raw)+'\n',sha256=digest(bytes),directory=join(site,'data/threads');
    await writeFile(join(directory,`${sha256}.json`),bytes);
    await writeFile(join(directory,`${platform()}-${arch()}.json`),JSON.stringify({schema:2,evidence:`${sha256}.json`,sha256})+'\n');
    process.exit(0);
  }
  const mode=parseCompilerMode(process.argv.slice(2),process.execArgv,process.env),flags=compilerModeFlags[mode];
  if(!['optimizing-only','liftoff-only'].includes(mode))throw new Error('Unsupported worker compiler mode');
  if(process.version!==`v${settings.node.version}` || process.versions.v8!==settings.node.v8)throw new Error('Worker V8 differs from pinned Turboshaft release');
  const compilerModeProbe=verifyCompilerMode(mode);
  const compilerModeSource=await readFile(join(root,'adapters/v8/compiler-mode.mjs'),'utf8');
  const compilerModeSourceSha256=digest(compilerModeSource);
  const collectorSource=await readFile(fileURLToPath(import.meta.url),'utf8');
  const collectorSha256=digest(collectorSource);
  const nodeExecutableSha256=digest(await readFile(process.execPath));
  const artifact = await readFile(join(site,'corpora/features/artifacts/threads-workers.wasm'));
  const source = await readFile(join(site,'corpora/features/sources/threads-workers.wat'));
  const results=[];
  const once = worker => new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error('Thread workload timed out')),30000);
    const done = value=>{clearTimeout(timer);worker.off('error',error);resolve(value);};
    const error = e=>{clearTimeout(timer);worker.off('message',done);reject(e);};
    worker.once('message',done);worker.once('error',error);
  });
  for (const sharing of ['contended','disjoint']) for (const workers of [1,2,4,8]) for (const operations of [1000,10000,100000,1000000]) {
    const launches=[];
    for(let launch=0;launch<3;launch++) {
      const memory=new WebAssembly.Memory({initial:4,maximum:4,shared:true});
      const module=new WebAssembly.Module(artifact);
      const group=[],ready=[];
      for(let index=0;index<workers;index++) {
        const worker=new Worker(new URL(import.meta.url),{workerData:{module,memory,compilerMode:mode}});
        group.push(worker);ready.push(once(worker));
      }
      try {
        const workerTierProbes=await Promise.all(ready);
        if(workerTierProbes.some(p=>JSON.stringify(p.flags)!==JSON.stringify(flags) || p.probe.liftoff!==(mode==='liftoff-only') || p.probe.optimizing!==(mode==='optimizing-only') || p.probe.collector_version!==settings.node.v8))throw new Error('Worker did not inherit the requested eager tier lock');
        const slots=new Int32Array(memory.buffer);
        const samples=[];
        for(let sample=-1;sample<3;sample++) {
          slots.fill(0);
          const completed=group.map(once);
          const start=process.hrtime.bigint();
          group.forEach((worker,index)=>worker.postMessage({operations,address:sharing==='contended'?0:index*64}));
          await Promise.all(completed);
          const elapsedNs=Number(process.hrtime.bigint()-start);
          if(sharing==='contended') {
            if(Atomics.load(slots,0)!==workers*operations)throw new Error('Incorrect shared counter');
          } else for(let index=0;index<workers;index++)if(Atomics.load(slots,index*16)!==operations)throw new Error('Incorrect disjoint counter');
          if(sample>=0)samples.push({elapsedNs,operations:workers*operations,verified:true});
        }
        launches.push({launch,samples,workerTierProbes});
      } finally {await Promise.all(group.map(worker=>worker.terminate()));}
    }
    results.push({compilerMode:mode,sharing,workers,operationsPerWorker:operations,launches});
    console.log(`Verified ${mode} ${sharing}: ${workers} workers x ${operations} atomic increments`);
  }
  if(digest(await readFile(fileURLToPath(import.meta.url)))!==collectorSha256)throw new Error('Worker collector source changed during measurement');
  if(digest(await readFile(join(root,'adapters/v8/compiler-mode.mjs')))!==compilerModeSourceSha256)throw new Error('Worker tier calibration source changed during measurement');
  const result={schema:1,created:new Date().toISOString(),feature:'threads',configuration:`V8 ${mode} / Node worker_threads / shared imported WebAssembly.Memory`,compilerMode:mode,compilerModeProbe,compilerModeSource,compilerModeSourceSha256,
    host:{hostname:hostname(),os:platform(),arch:arch(),logicalCpus:cpus().length},node:process.version,v8:process.versions.v8,flags:process.execArgv,
    artifactSha256:digest(artifact),sourceSha256:digest(source),collectorSha256,collectorSource,nodeExecutableSha256,collector:'node:process.hrtime.bigint',
    policy:'Three independently created worker groups; one warmup and three verified batches each. Timer includes message dispatch, concurrent guest atomic increments and completion messages, excludes module compilation/worker startup and oracle checks. Disjoint counters are 64 bytes apart. No CPU affinity or frequency control.',results};
  const bytes=JSON.stringify(result)+'\n';const sha256=digest(bytes);
  const directory=join(site,'data/threads');await mkdir(directory,{recursive:true});
  await writeFile(join(directory,`${sha256}.json`),bytes);
  await writeFile(join(directory,`${platform()}-${arch()}-${mode}.json`),JSON.stringify({schema:1,evidence:`${sha256}.json`,sha256})+'\n');
}
