import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fixtures } from '../corpora/features/generator.mjs';
import { applicationWorkloads } from './lib/application-manifest.mjs';
import { spawnSync } from 'node:child_process';
import { prepareCorpus } from './lib/corpus.mjs';
import { config, digest, site, harness } from './lib/wasmbench.mjs';

const settings=await config();
if(process.version!==`v${settings.node.version}`||process.versions.v8!==settings.node.v8)throw Error('Use pinned Node/V8 from wasmbench.config.json');
const suiteOnly=process.argv[2]==='--suite-only';
const selection=suiteOnly?process.argv[3]:process.argv[2];
if(suiteOnly&&!selection)throw Error('--suite-only requires a prepared manifest');
const workloads=suiteOnly?[]:await applicationWorkloads('corpora/applications/manifest.json');
const root=join(site,'corpora/features');
const manifest=JSON.parse(await readFile(join(root,'manifest.json')));
const generated=new Map(fixtures().flatMap(f=>f.sizes.map(size=>[`features/${f.feature}/${f.name}/${size}`,{f,size}])));
if(manifest.length!==generated.size)throw Error('Feature inventory mismatch');
for(const w of suiteOnly?[]:manifest) {
  const item=generated.get(w.id);if(!item)throw Error('Unknown feature fixture: '+w.id);
  const {f,size}=item;
  const source=await readFile(join(root,w.source),'utf8');
  if(source!==f.wat.trim()+'\n'||digest(source)!==w.provenance.recipe.sourceSha256)throw Error('Stale feature source: '+w.id);
  const oracle=f.oracle?f.oracle(size):{kind:'exact_u64',expected:[f.abi==='component'?String(f.expected(size)):f.expected(size)]};
  if(JSON.stringify(w.oracle)!==JSON.stringify(oracle))throw Error('Stale feature oracle: '+w.id);
  const fields={abi:f.abi || 'core',export:f.export ?? 'benchmark',reset:f.reset,args:f.args?f.args(size):[f.abi==='component'?String(size):size]};
  if(f.command)fields.command=f.command(size);
  for(const [key,value] of Object.entries(fields))if(JSON.stringify(w[key])!==JSON.stringify(value))throw Error('Stale feature '+key+': '+w.id);
  workloads.push({...w,artifact:resolve(root,w.artifact)});
}
// Optionally check the exact prepared upstream selection as well.
if(selection!=='--local') {
  let path;
  if(selection==='--from-source')path=resolve(site,settings.corpus.buildManifest);
  else if(selection)path=resolve(selection);
  else {const h=await harness();path=await prepareCorpus(h.settings,h.run);}
  const imported=JSON.parse(await readFile(path));
  workloads.push(...imported.filter(w=>!workloads.some(existing=>existing.id===w.id)).map(w=>({...w,artifact:resolve(dirname(path),w.artifact)})));
}
const outcomes=[];
for(const w of workloads) {
  const result=spawnSync(process.execPath,[join(site,'scripts/corpus-v8-worker.mjs')],{
    input:JSON.stringify(w),encoding:'utf8',timeout:30_000,maxBuffer:2<<20,env:{...process.env,NODE_NO_WARNINGS:'1'}
  });
  let outcome;
  try {outcome=JSON.parse(result.stdout);if(!['verified','unavailable','failed'].includes(outcome.status))throw Error('Invalid worker outcome');}
  catch {outcome={status:'failed',reason:result.error?.message || result.stderr || `Worker exited ${result.status}/${result.signal}`};}
  if(result.status!==0&&outcome.status!=='failed')outcome={status:'failed',reason:`Worker exited ${result.status}/${result.signal}`};
  outcomes.push({id:w.id,sha256:w.sha256,...outcome});
}
const report={schema:1,node:process.version,v8:process.versions.v8,flags:process.execArgv,wasiEnvironment:{LANG:'C.UTF-8'},policy:'Independent exact contracts, Each workload runs in a separate process with a 30-second timeout; three fresh instances and three reused-instance calls for stateless workloads. Compile rejection is unavailable, never passing. Components require a separate Wasmtime check.',outcomes};
await mkdir(join(site,'.wasmbench'),{recursive:true});
await writeFile(join(site,'.wasmbench/corpus-v8-check.json'),JSON.stringify(report,null,2)+'\n');
const count=status=>outcomes.filter(o=>o.status===status).length;
console.log(`V8 ${process.versions.v8}: ${count('verified')} verified, ${count('unavailable')} unavailable, ${count('failed')} failed`);
for(const o of outcomes.filter(o=>o.status!=='verified'))console.log(`${o.status}: ${o.id}: ${o.reason}`);
if(count('failed'))process.exitCode=1;
