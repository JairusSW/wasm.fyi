import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { hostname, arch, platform, cpus } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, site } from './lib/wasmbench.mjs';
if (!isMainThread) {
  const instance = new WebAssembly.Instance(workerData.module, {env:{memory:workerData.memory}});
  parentPort.on('message', ({operations,address}) => { instance.exports.increment(operations,address); parentPort.postMessage('done'); });
  parentPort.postMessage('ready');
} else {
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
        const worker=new Worker(new URL(import.meta.url),{workerData:{module,memory}});
        group.push(worker);ready.push(once(worker));
      }
      try {
        await Promise.all(ready);
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
        launches.push({launch,samples});
      } finally {await Promise.all(group.map(worker=>worker.terminate()));}
    }
    results.push({sharing,workers,operationsPerWorker:operations,launches});
    console.log(`Verified ${sharing}: ${workers} workers x ${operations} atomic increments`);
  }
  if(digest(await readFile(fileURLToPath(import.meta.url)))!==collectorSha256)throw new Error('Worker collector source changed during measurement');
  const result={schema:1,created:new Date().toISOString(),feature:'threads',configuration:'Node worker_threads / shared imported WebAssembly.Memory',
    host:{hostname:hostname(),os:platform(),arch:arch(),logicalCpus:cpus().length},node:process.version,v8:process.versions.v8,flags:process.execArgv,
    artifactSha256:digest(artifact),sourceSha256:digest(source),collectorSha256,collectorSource,nodeExecutableSha256,collector:'node:process.hrtime.bigint',
    policy:'Three independently created worker groups; one warmup and three verified batches each. Timer includes message dispatch, concurrent guest atomic increments and completion messages, excludes module compilation/worker startup and oracle checks. Disjoint counters are 64 bytes apart. No CPU affinity or frequency control.',results};
  const bytes=JSON.stringify(result)+'\n';const sha256=digest(bytes);
  const directory=join(site,'data/threads');await mkdir(directory,{recursive:true});
  await writeFile(join(directory,`${sha256}.json`),bytes);
  await writeFile(join(directory,`${platform()}-${arch()}.json`),JSON.stringify({schema:1,evidence:`${sha256}.json`,sha256})+'\n');
}
