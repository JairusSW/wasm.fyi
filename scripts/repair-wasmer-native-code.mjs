// Repair the optional code-size observer without repeating valid timing samples.
import {readFile,readdir,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildHistoricalBinding} from './lib/historical-binding.mjs';
import {command} from './lib/wasmbench.mjs';
import {readCache,atomicJSON} from './lib/benchmark-plan.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {acquireMeasurementLock} from './lib/measurement-lock.mjs';
import {summarizeResources} from './lib/latency-capture.mjs';
const [rootArg,configuration]=process.argv.slice(2),root=resolve(rootArg);
if(!['wasmer-singlepass','wasmer-llvm'].includes(configuration))throw Error('Wasmer backend required');
const template=JSON.parse(await readFile(join(root,'collection-template.json'))),plan=JSON.parse(await readFile(join(root,'source-plan.json')));
const pin=plan.pins.find(p=>p.engine==='wasmer'&&p.status==='planned');
const directory=join(root,'sdk-builds',[configuration,pin.targetType,pin.tag||pin.revision].join('-').replace(/[^a-zA-Z0-9.-]/g,'_'));
const bindingPath=join(directory,'binding.json');
let binding;
while(!binding){binding=await readFile(bindingPath,'utf8').then(JSON.parse,()=>null);if(!binding)await new Promise(r=>setTimeout(r,10000));}
// Do not replace a shared library while this backend is still collecting.
while(true){
 const status=await readFile(join(root,'wasmer-supplement-history-status.json'),'utf8').then(JSON.parse,()=>null);
 if(status?.completed?.some(done=>done.configuration===configuration))break;
 await new Promise(r=>setTimeout(r,10000));
}
const harness=join(directory,'harness'),controller=join(root,'controller-year');
const env={...process.env,...template.env,...binding.environment,GOMAXPROCS:template.env?.WASMFYI_BUILD_JOBS||'1',CARGO_BUILD_JOBS:template.env?.WASMFYI_BUILD_JOBS||'1',WASMBENCH_CODE_SIZE_ONLY:'1'};
const log=join(root,configuration+'-code-repair.log');
const invoke=(...args)=>command(controller,args,{cwd:harness,env,stdio:'inherit'});
const release=await acquireMeasurementLock(join(root,'measurement-lock'));
try {
if(!binding.source.measurementPatchSha256)binding=await buildHistoricalBinding({root:harness,pin,configuration,invoke,env});
if(!binding.source.measurementPatchSha256)throw Error('Pinned Wasmer API cannot expose complete native function extents');
binding.environment=Object.fromEntries(Object.entries(env).filter(([key])=>key.startsWith('WASMBENCH_')));
await atomicJSON(bindingPath,binding);
 const workloads=new Map((await readCache(template.corpusRoot)).map(w=>[w.id,w]));let repaired=0;
 for(const file of await readdir(join(root,'captures'))){
  if(!file.endsWith('.json'))continue;
  const path=join(root,'captures',file),capture=JSON.parse(await readFile(path));
  if(capture.results[0].engine!==configuration||capture.results.every(r=>r.latencyStatus!=='ok'||r.codeStatus==='ok'))continue;
  const workload=workloads.get(capture.results[0].workload);if(!workload||workload.sha256!==capture.results[0].artifactSha256)throw Error('Repair artifact differs');
  const scratch=join(root,'code-repairs',file.slice(0,-5));await mkdir(scratch,{recursive:true});
  const suite=join(scratch,'suite.json'),out=join(scratch,'code-'+file.slice(0,-5)+'-'+Date.now());await rm(out,{recursive:true,force:true});await atomicJSON(suite,[workload]);
  const args=[controller,'run','--archive-tools=false','--suite',suite,'--runtimes',configuration,'--workers','1','--timeout',template.collection.timeout,'--validation-profile','all','--timing-peak-rss=false','--profile','code','--launches','1','--scenarios','compile','--samples','1','--samples-by-scenario','{"*":1}','--operations','1','--warmup','0','--out',out];
  const program=process.platform==='linux'?'taskset':'taskpolicy';
  await runCommand(program,process.platform==='linux'?['-c',String(template.cpu),...args]:['-a','-t','0','-l','0',...args],{cwd:harness,env,log});
  const trials=await Promise.all((await readdir(join(out,'trials'))).filter(n=>n.endsWith('.json')).map(async n=>JSON.parse(await readFile(join(out,'trials',n)))));
  const code=summarizeResources(trials,'compile');
  if(code.codeStatus!=='ok'||!(code.codeBytes>0))throw Error('Native code observer failed: '+file);
  for(const row of capture.results)if(row.latencyStatus==='ok')Object.assign(row,{codeStatus:code.codeStatus,codeBytes:code.codeBytes,codeKind:code.codeKind});
  capture.capturedAt=new Date().toISOString();
  await atomicJSON(path,capture);await rm(scratch,{recursive:true,force:true});repaired++;
 }
 await atomicJSON(join(root,configuration+'-code-repair.json'),{status:'completed',repaired,measurementPatchSha256:binding.source.measurementPatchSha256,completed:new Date().toISOString()});
} finally {await release();}
