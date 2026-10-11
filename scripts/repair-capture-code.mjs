import {readFile,readdir,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readCache,atomicJSON} from './lib/benchmark-plan.mjs';
import {summarizeResources} from './lib/latency-capture.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';

export async function repairCaptureCode(root,configuration){
 const template=JSON.parse(await readFile(join(root,'collection-template.json')));
 const jobs=[];
 for(const dir of await readdir(join(root,'engine-builds')).catch(()=>[])){
  const plan=await readFile(join(root,'engine-builds',dir,'plan.json'),'utf8').then(JSON.parse,()=>null);
  jobs.push(...(plan?.jobs||[]).filter(job=>job.engine===configuration));
 }
 const workloads=new Map((await readCache(template.corpusRoot)).map(w=>[w.id,w]));
 const release=await acquireMeasurementLock(join(root,'measurement-lock'));let repaired=0;
 try{
  for(const file of await readdir(join(root,'captures'))){
   if(!file.endsWith('.json'))continue;
   const path=join(root,'captures',file),capture=JSON.parse(await readFile(path));
   if(capture.results[0].engine!==configuration||capture.results.every(row=>row.latencyStatus!=='ok'||row.codeStatus==='ok'))continue;
   const job=jobs.find(j=>j.source.revision===capture.source.revision&&j.source.asOf===capture.source.asOf);
   if(!job)throw Error('Missing exact source job for '+file);
   const workload=workloads.get(capture.results[0].workload);
   if(!workload||workload.sha256!==capture.results[0].artifactSha256)throw Error('Code repair artifact differs');
   const scratch=join(root,'code-repairs',file.slice(0,-5)),out=join(scratch,'code-'+file.slice(0,-5)+'-'+Date.now()),suite=join(scratch,'suite.json');
   await mkdir(scratch,{recursive:true});await rm(out,{recursive:true,force:true});await atomicJSON(suite,[workload]);
   const env={...process.env,...template.env,...job.env,GOMAXPROCS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',WASMBENCH_CODE_SIZE_ONLY:'1',WASMBENCH_SINGLE_CORE:'1'};
   if(configuration.startsWith('wamr-'))env.WASMBENCH_WAMR_MODE=configuration.slice(5);
   const args=[job.controller||template.controller,'run','--archive-tools=false','--suite',suite,'--runtimes',configuration,'--workers','1','--timeout',template.collection.timeout,'--validation-profile','all','--timing-peak-rss=false','--profile','code','--launches','1','--scenarios','compile','--samples','1','--samples-by-scenario','{"*":1}','--operations','1','--warmup','0','--out',out];
   await runCommand(process.platform==='linux'?'taskset':'taskpolicy',process.platform==='linux'?['-c',String(template.cpu),...args]:['-a','-t','0','-l','0',...args],{cwd:job.harness,env,log:join(root,configuration+'-code-repair.log')});
   const manifest=JSON.parse(await readFile(join(out,'manifest.json'))),description=manifest.lock.runtime_configurations[0].description;
   if(description.runtime_version!==capture.results[0].version||description.backend!==capture.results[0].backend)throw Error('Runtime identity changed during code-only repair');
   const trials=await Promise.all((await readdir(join(out,'trials'))).filter(n=>n.endsWith('.json')).map(async n=>JSON.parse(await readFile(join(out,'trials',n)))));
   const code=summarizeResources(trials,'compile');if(code.codeStatus!=='ok'||!(code.codeBytes>0))throw Error('Native code observer failed: '+file);
   for(const row of capture.results)if(row.latencyStatus==='ok')Object.assign(row,{codeStatus:code.codeStatus,codeBytes:code.codeBytes,codeKind:code.codeKind});
   await atomicJSON(path,capture);await rm(scratch,{recursive:true,force:true});repaired++;
  }
  await atomicJSON(join(root,configuration+'-code-repair.json'),{status:'completed',repaired,timingSamplesPreserved:true,completed:new Date().toISOString()});
 }finally{await release();}
}
if(process.argv[1]===new URL(import.meta.url).pathname)await repairCaptureCode(resolve(process.argv[2]),process.argv[3]);
