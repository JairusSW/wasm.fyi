// Exercise the full compact collector; these probes are never published as
// corpus coverage. Use the same host lock as production measurements.
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {digest} from './lib/wasmbench.mjs';
import {assertQualifiedCaptureRow} from './lib/qualification-capture.mjs';
const [rootArg,directoryArg,engine]=process.argv.slice(2),root=resolve(rootArg),directory=resolve(directoryArg);
const receipt=JSON.parse(await readFile(join(directory,engine+'-build.json')));
const template=JSON.parse(await readFile(join(root,'collection-template.json')));
if(template.collection.samples<12)throw Error('Twelve samples are required');
const ids=['applications/numeric-euclidean-gcd','mechanisms/wasm-to-host-call','mechanisms/wasm-host-wasm-loop'];
const workloads=ids.map(id=>template.workloads.find(w=>w.id===id));
if(workloads.some(w=>!w))throw Error('Required capture probe missing');
const pin=receipt.pin||receipt.binding.release;
const source={repository:pin.repository,revision:pin.revision||receipt.binding?.source.revision,ref:pin.tag||'main@'+pin.revision.slice(0,8),asOf:pin.targetWeek,kind:pin.targetType==='main'?'snapshot':'release'};
if(!source.revision)throw Error('SDK has no exact source identity');
const id='capture-qualification-'+receipt.runtime.id+'-'+digest(Buffer.from(JSON.stringify([source,receipt.harnessRevision,receipt.runtime.file_sha256]))).slice(0,16);
const job={id,engine:receipt.runtime.id,harness:receipt.root,controller:receipt.controller||join(root,'controller-year'),env:receipt.env,historical:true,source};
const worker=join(directory,'capture-qualification'),output=join(root,'qualification-captures');
await mkdir(worker,{recursive:true});
await atomicJSON(join(worker,'plan.json'),{...template,captureDirectory:output,workloads,jobs:[job]});
await runCommand(process.execPath,['scripts/benchmark-history-worker.mjs',worker],{log:join(worker,'capture.log')});
const status=JSON.parse(await readFile(join(worker,'status.json')));
if(status.status!=='completed'||status.completed!==ids.length||status.errors.length)throw Error('Compact collector qualification incomplete');
const captures=[];
for(const workload of workloads){
 const capture=JSON.parse(await readFile(join(output,id+'-'+digest(Buffer.from(workload.id)).slice(0,16)+'.json')));
 if(capture.source.revision!==source.revision||capture.results.length!==4)throw Error('Capture identity or phase count differs');
 for(const phase of ['compile','instantiate','first-call','steady']){
  const row=capture.results.find(r=>r.phase===phase);
  assertQualifiedCaptureRow(row);
 }
 captures.push(capture);
}
await atomicJSON(join(directory,'capture-qualification.json'),{status:'qualified',scope:'Three compact-collector probes only; not published performance or corpus coverage',captures,runnerMs:status.runnerMs,captureMs:status.captureMs,completed:new Date().toISOString()});
console.log(JSON.stringify({configuration:receipt.runtime.id,status:'qualified',captures:captures.length,rows:captures.reduce((n,c)=>n+c.results.length,0),runnerMs:status.runnerMs,captureMs:status.captureMs}));
