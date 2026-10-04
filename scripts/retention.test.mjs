import test from 'node:test';
import assert from 'node:assert/strict';
import {appendReports,retainReports} from './lib/snapshot-index.mjs';
test('targeted refresh preserves other hosts, tiers and workload evidence beyond retention',()=>{
 const report=(id,date,runtime,workloads=['features/simd/a'],arch='arm64')=>({id,created:date,host:{hostname:arch,os:'test',arch},runtimes:[{id:runtime}],workloads:workloads.map(id=>({id,sha256:'a'.repeat(64)}))});
 const rows=[report('new','2026-10-02','wago'),report('v8','2026-10-01','v8-liftoff'),report('other-host','2026-09-30','wago',undefined,'amd64'),report('other-workload','2026-09-29','wago',['features/gc/b']),report('replaced','2026-09-28','wago')];
 assert.deepEqual(retainReports(rows,1).map(r=>r.id),['new','v8','other-host','other-workload']);
});
test('a newer engine identity cannot evict the last released identity',()=>{
 const host={hostname:'mac',os:'darwin',arch:'arm64'},workloads=[{id:'features/simd/a',sha256:'a'.repeat(64)}];
 const report=(id,created,version)=>({id,created,host,workloads,runtimes:[{id:'v8',description:{runtime_version:version}}]});
 assert.deepEqual(retainReports([report('new','2026-10-02','new'),report('released','2026-10-01','released'),report('duplicate','2026-09-30','released')],1).map(r=>r.id),['new','released']);
});
test('append unions every old report and replaces duplicate run IDs with incoming evidence',()=>{
 const report=(runId,created,id)=>({runId,created,id});
 const previous=Array.from({length:20},(_,i)=>report('old-'+i,`2026-09-${String(30-i).padStart(2,'0')}`,`old-${i}`));
 previous.push(report('refresh','2026-09-01','stale-refresh'));
 const incoming=[report('newer','2026-10-03','newer'),report('refresh','2026-10-02','verified-refresh')];
 const merged=appendReports(previous,incoming);
 assert.equal(merged.length,22);
 assert.equal(merged[0].runId,'newer');
 assert.equal(merged.find(r=>r.runId==='refresh').id,'verified-refresh');
 assert.equal(merged.filter(r=>r.runId==='refresh').length,1);
});
test('verified host aliases share feature evidence only under identical hardware and kernel facts',async()=>{
 const {featureHostKey}=await import('./lib/feature-support.mjs');
 const host={hostname:'local',os:'darwin',arch:'arm64',cpu_description:'M4 Max',logical_cpus:16,page_size:16384,kernel:'Darwin 25.6'};
 const aliases={local:'mac',tailnet:'mac'};
 assert.equal(featureHostKey(host,aliases),featureHostKey({...host,hostname:'tailnet'},aliases));
 assert.notEqual(featureHostKey(host,aliases),featureHostKey({...host,hostname:'tailnet',cpu_description:'Different CPU'},aliases));
 assert.notEqual(featureHostKey(host,aliases),featureHostKey({...host,hostname:'other'},aliases));
});
test('staging copies remain independently writable',async()=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {cloneCopy}=await import('./lib/copy.mjs');const dir=await mkdtemp(join(tmpdir(),'wasm-fyi-copy-'));
 try{await writeFile(join(dir,'original'),'sealed');await cloneCopy(join(dir,'original'),join(dir,'copy'));await writeFile(join(dir,'copy'),'changed');assert.equal(await readFile(join(dir,'original'),'utf8'),'sealed');}
 finally{await rm(dir,{recursive:true,force:true});}
});
