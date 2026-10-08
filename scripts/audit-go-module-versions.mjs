import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {engineSources} from './lib/engine-sources.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
const exec=promisify(execFile),root=resolve(process.argv[2]),engine=process.argv[3];
if(!['wago','wazero','wasm2go'].includes(engine))throw Error('Not a Go runtime/module engine');
const base='https://proxy.golang.org/github.com/'+engineSources[engine].repository+'/@v/';
async function get(url){return (await exec('curl',['--fail','--silent','--show-error','--retry','3','--max-time','60',url],{encoding:'utf8',timeout:65000,maxBuffer:4*1024*1024})).stdout;}
const names=(await get(base+'list')).trim().split(/\s+/),versions=[];
for(let offset=0;offset<names.length;offset+=4)versions.push(...await Promise.all(names.slice(offset,offset+4).map(async version=>JSON.parse(await get(base+encodeURIComponent(version)+'.info')))));
await atomicJSON(join(root,engine+'-module-version-audit.json'),{provider:base,auditedAt:new Date().toISOString(),versions});
console.log(JSON.stringify({engine,versions:versions.length}));
