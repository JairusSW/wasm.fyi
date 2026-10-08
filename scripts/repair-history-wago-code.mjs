// Rerun only captures with audited code gaps, preserving the original source
// targets and file identities. Fresh timings retain twelve samples per phase.
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {runCommand} from './lib/benchmark-process.mjs';
import {digest} from './lib/wasmbench.mjs';
const [rootArg,machine]=process.argv.slice(2),root=resolve(rootArg);
const audit=JSON.parse(await readFile(join(root,'wago-corpus-capture-audit.json'))),template=JSON.parse(await readFile(join(root,'collection-template.json')));
const selected=audit.machines.find(m=>m.machine===machine);if(!selected||template.collection.samples<12)throw Error('Audited host and twelve samples required');
const files=[...new Set(selected.resourceGaps.filter(g=>!g.code).map(g=>g.file))],groups=new Map();
for(const file of files){
 const capture=JSON.parse(await readFile(join(root,'captures',file)));
 if(capture.results.every(r=>r.latencyStatus!=='ok'||r.codeStatus==='ok'&&r.codeBytes>0))continue;
 const revision=capture.source.revision;
 if(!/^[0-9a-f]{40}$/.test(revision)||capture.results.some(r=>r.engine!=='wago'))throw Error('Unexpected repair source');
 const group=groups.get(revision)||[];group.push({file,capture});groups.set(revision,group);
}
for(const [revision,captures] of groups){
 await runCommand(process.execPath,['scripts/refresh-history-wago-sdk.mjs',root,revision],{log:join(root,'wago-code-repair.log')});
 const receipt=JSON.parse(await readFile(join(root,'builds','wago-'+revision,'wago-build.json')));
 for(const {file,capture} of captures){
  const workload=capture.results[0].workload,suffix='-'+digest(Buffer.from(workload)).slice(0,16)+'.json';if(!file.endsWith(suffix))throw Error('Capture identity differs');
  const directory=join(root,'repairs','wago-code',file.slice(0,-5));await mkdir(directory,{recursive:true});
  await copyFile(join(root,'captures',file),join(directory,'before.json'));
  const job={id:file.slice(0,-suffix.length),engine:'wago',historical:true,forceCapture:true,harness:receipt.root,controller:receipt.controller,env:receipt.env,source:capture.source};
  await atomicJSON(join(directory,'plan.json'),{...template,captureDirectory:join(root,'captures'),workloads:template.workloads.filter(w=>w.id===workload),jobs:[job]});
  await runCommand(process.execPath,['scripts/benchmark-history-worker.mjs',directory],{log:join(directory,'repair.log')});
  const repaired=JSON.parse(await readFile(join(root,'captures',file)));
  if(repaired.results.some(r=>r.latencyStatus!=='ok'||r.timingSamples<12||r.memoryStatus!=='ok'||r.peakRssBytes<=0||r.codeStatus!=='ok'||r.codeBytes<=0))throw Error('Native code repair incomplete: '+file);
  await atomicJSON(join(directory,'completion.json'),{file,workload,revision,samples:12,completed:new Date().toISOString()});console.log(JSON.stringify({repaired:file}));
 }
}
