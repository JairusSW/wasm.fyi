import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {engineSources} from './lib/engine-sources.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';

const exec=promisify(execFile),root=resolve(process.argv[2]);
const plan=JSON.parse(await readFile(join(root,'source-plan.json')));
const entries=Object.entries(engineSources).filter(([,spec])=>!spec.provider);
const results=[];
for(let offset=0;offset<entries.length;offset+=4){
 const batch=await Promise.all(entries.slice(offset,offset+4).map(async([engine,spec])=>{
  try{
   const {stdout}=await exec('git',['ls-remote','--tags','https://github.com/'+spec.repository+'.git'],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
   const tags=new Map();
   for(const line of stdout.trim().split('\n')){
    const match=line.match(/^([a-f0-9]{40})\s+refs\/tags\/(.+?)(\^\{\})?$/);
    if(!match)continue;
    const [,revision,tag,peeled]=match;
    if(peeled||!tags.has(tag))tags.set(tag,{tag,revision,annotated:!!peeled});
   }
   const planned=new Set(plan.pins.filter(p=>p.engine===engine&&p.targetType==='release'&&p.status==='planned').map(p=>p.tag));
   const versionTags=[...tags.values()].filter(t=>/(?:^|[-_v])\d+\.\d+\.\d+(?:$|[-+._])/.test(t.tag)||engine==='wavm'&&/nightly/i.test(t.tag));
   return {engine,repository:spec.repository,tagCount:tags.size,versionTagCount:versionTags.length,plannedVersionCount:planned.size,unplannedTags:versionTags.filter(t=>!planned.has(t.tag)),status:'needs-date-audit'};
  }catch(error){return {engine,repository:spec.repository,status:'error',error:String(error)};}
 }));
 results.push(...batch);
 await atomicJSON(join(root,'version-tag-audit.json'),{auditedAt:new Date().toISOString(),anchor:plan.anchor,cutoff:plan.cutoff,scope:'Version-like Git tags compared with the source plan. Unplanned tags require commit/publication date checks; old tags are not missing YTD versions. Official Node, Firefox and WebKit release providers are audited separately.',results});
 for(const row of batch)console.log(JSON.stringify({engine:row.engine,status:row.status,tags:row.versionTagCount,unplanned:row.unplannedTags?.length}));
}
