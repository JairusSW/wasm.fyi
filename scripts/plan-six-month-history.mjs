import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {engineSources,pinMain,pinEveryRelease} from './lib/engine-sources.mjs';
import {saturdays,monthsBefore} from './lib/weekly-history.mjs';
const root=join(process.cwd(),'.wasmfyi/local/history-versions-20261007');await mkdir(root,{recursive:true});
const anchor=new Date().toISOString(),cutoff=monthsBefore(anchor,6);const dates=saturdays(new Date(anchor),27).filter(d=>Date.parse(d)>=Date.parse(cutoff)&&Date.parse(d)<=Date.parse(anchor)).reverse();
const engines=['wago','wazero','wasmtime','v8','wasmer','wavm','wasm2go','libwasm','wamr','wasmi','wasm3','jsc','spidermonkey'];
const plan={anchor,cutoff,policy:'Current builds first, then each engine newest to oldest. Weekly default-branch source snapshots and eligible published releases. Repeated source revisions are measured once on the same fixed corpus. Historical targets cannot precede cutoff.',machines:['local-arm64','hub-amd64'],engines:[],pins:[]};
for(const engine of engines){const main=await pinMain(engine,dates);const releases=await pinEveryRelease(engine,cutoff,anchor);const pins=[...main,...releases].sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek));plan.engines.push({engine,repository:engineSources[engine].repository,planned:pins.filter(p=>p.status==='planned').length,gaps:pins.filter(p=>p.status!=='planned').length});plan.pins.push(...pins);await writeFile(join(root,'source-plan.json'),JSON.stringify(plan,null,2));console.log(JSON.stringify(plan.engines.at(-1)));}
