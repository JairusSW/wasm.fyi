import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {command} from './lib/wasmbench.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
const [rootArg,directoryArg,engine,label]=process.argv.slice(2),root=resolve(rootArg),directory=resolve(directoryArg);
if(!/^[a-z0-9-]+$/.test(label))throw Error('A safe measurement label is required');
const receipt=JSON.parse(await readFile(join(directory,engine+'-build.json'))),template=JSON.parse(await readFile(join(root,'collection-template.json')));
const env={...process.env,...template.env,...receipt.env,GOMAXPROCS:'1',OMP_NUM_THREADS:'1',RAYON_NUM_THREADS:'1',WASMBENCH_SINGLE_CORE:'1'};
const runtime=receipt.runtime.command;
const args=process.platform==='linux'?['--cpu-list',String(template.cpu),...runtime]:process.platform==='darwin'?['-a','-t','0','-l','0',...runtime]:runtime.slice(1);
const executable=process.platform==='linux'?'taskset':process.platform==='darwin'?'taskpolicy':runtime[0];
const release=await acquireMeasurementLock(join(root,'measurement-lock'));
try{
 const samples=[];
 for(let index=0;index<12;index++){
  const start=performance.now();
  const output=command(executable,args,{cwd:receipt.root,env,timeout:30000,input:'{"version":1,"id":1,"method":"describe"}\n{"version":1,"id":2,"method":"close"}\n'}).toString();
  const elapsedMs=performance.now()-start;
  const responses=output.trim().split('\n').map(JSON.parse);
  if(responses.length!==2||responses.some(r=>r.status!=='ok')||responses[0].description.runtime!==engine)throw Error('Startup protocol verification failed');
  samples.push(elapsedMs);
 }
 const sorted=[...samples].sort((a,b)=>a-b),medianMs=(sorted[5]+sorted[6])/2;
 const result={label,configuration:receipt.runtime.id,metric:'process startup, verified describe and close wall time',samplesMs:samples,medianMs,scope:'Startup diagnosis only; not published benchmark latency',completed:new Date().toISOString()};
 await atomicJSON(join(directory,'startup-'+label+'.json'),result);console.log(JSON.stringify({label,medianMs,samples:samples.length}));
}finally{await release();}
