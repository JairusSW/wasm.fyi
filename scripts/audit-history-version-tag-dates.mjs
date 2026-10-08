import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {atomicJSON} from './lib/benchmark-plan.mjs';

const exec=promisify(execFile),root=resolve(process.argv[2]);
const inventory=JSON.parse(await readFile(join(root,'version-tag-audit.json')));
const path=join(root,'version-tag-date-audit.json');
const audit=await readFile(path,'utf8').then(JSON.parse,()=>({anchor:inventory.anchor,cutoff:inventory.cutoff,results:[]}));
if(audit.anchor!==inventory.anchor||audit.cutoff!==inventory.cutoff)throw Error('Version audit bounds changed');
for(const row of inventory.results){
 if(row.status==='error')throw Error('Tag inventory failed for '+row.engine);
 if(audit.results.some(r=>r.engine===row.engine&&r.status==='audited'))continue;
 const [owner,name]=row.repository.split('/'),tags=[];
 for(let offset=0;offset<row.unplannedTags.length;offset+=40){
  const batch=row.unplannedTags.slice(offset,offset+40);
  const fields=batch.map((tag,i)=>`t${i}: object(expression:${JSON.stringify('refs/tags/'+tag.tag)}) { __typename ... on Commit { oid committedDate } ... on Tag { oid tagger { date } target { __typename ... on Commit { oid committedDate } } } }`).join('\n');
  const query=`query { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { ${fields} } }`;
  const {stdout}=await exec('gh',['api','graphql','-f','query='+query],{encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
  const response=JSON.parse(stdout);
  if(response.errors?.length)throw Error(JSON.stringify(response.errors));
  for(let i=0;i<batch.length;i++){
   const object=response.data?.repository?.['t'+i];
   const commit=object?.__typename==='Commit'?object:object?.target;
   if(commit?.__typename!=='Commit'&&object?.__typename!=='Commit'||!commit?.committedDate||commit.oid!==batch[i].revision)throw Error('Tag commit could not be verified: '+row.engine+' '+batch[i].tag);
   tags.push({...batch[i],committedAt:commit.committedDate,taggedAt:object?.tagger?.date||null,inYtd:Date.parse(commit.committedDate)>=Date.parse(inventory.cutoff)&&Date.parse(commit.committedDate)<=Date.parse(inventory.anchor)});
  }
 }
 const result={engine:row.engine,repository:row.repository,status:'audited',tags,unplannedYtdTags:tags.filter(t=>t.inYtd)};
 audit.results=audit.results.filter(r=>r.engine!==row.engine);audit.results.push(result);
 audit.auditedAt=new Date().toISOString();
 audit.scope='Commit dates for version-like tags absent from the plan. YTD candidates still require release/provider semantics and source-build review before adding targets; commit dates are not claimed as publication dates.';
 await atomicJSON(path,audit);
 console.log(JSON.stringify({engine:row.engine,unplannedYtdTags:result.unplannedYtdTags}));
}
