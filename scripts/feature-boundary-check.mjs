// Untimed boundary checks: two fresh instances, three calls per stateless instance.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixtures} from '../corpora/features/generator.mjs';
import {featureValidationSizes,featureValidationWorkload} from './lib/feature-validation.mjs';
import {site,digest} from './lib/wasmbench.mjs';
const root=join(site,'corpora/features'),output=resolve(process.argv[2]||join(site,'.wasmbench/feature-boundary-check.json'));
const manifest=JSON.parse(await readFile(join(root,'manifest.json'))),outcomes=[],components=[];
for(const fixture of fixtures()) {
 if(fixture.scope==='compile-only')continue;
 const template=manifest.find(w=>w.id===`features/${fixture.feature}/${fixture.name}/${fixture.sizes[0]}`);
 if(!template)throw Error('Missing rebuilt fixture: '+fixture.name);
 const source=await readFile(join(root,template.source));
 if(source.toString()!==fixture.wat.trim()+'\n'||digest(source)!==template.provenance.recipe.sourceSha256)throw Error('Stale feature source: '+template.id);
 for(const size of featureValidationSizes(fixture)){
  const w=featureValidationWorkload(fixture,size,template);w.artifact=join(root,w.artifact);
  if(w.abi==='component'){components.push(w);continue;}
  const result=spawnSync(process.execPath,['--input-type=module','-e',`import {checkV8} from ${JSON.stringify(new URL('./lib/v8-corpus.mjs',import.meta.url).href)};import {readFileSync} from 'node:fs';try{console.log(JSON.stringify(await checkV8(JSON.parse(readFileSync(0,'utf8')),{repeat:2})));}catch(error){console.log(JSON.stringify({status:'failed',reason:error.message}));process.exitCode=1;}`],{input:JSON.stringify(w),encoding:'utf8',timeout:30000,maxBuffer:2<<20,env:{...process.env,NODE_NO_WARNINGS:'1'}});
  let outcome;try{outcome=JSON.parse(result.stdout);if(!['verified','unavailable','failed'].includes(outcome.status))throw Error('Invalid worker response');}catch{outcome={status:'failed',reason:result.error?.message||result.stderr||'Invalid worker response'};}
  if(result.status!==0&&outcome.status!=='failed')outcome={status:'failed',reason:`Worker exited ${result.status}/${result.signal}`};
  outcomes.push({id:w.id,size,reset:w.reset,...outcome});
 }
}
await mkdir(join(output,'..'),{recursive:true});
const report={node:process.version,v8:process.versions.v8,timing:false,policy:'Two fresh instances per boundary input; three consecutive calls on each stateless instance; allocating/destructive fixtures get fresh instances. Oracles come from source generators.',outcomes};
await writeFile(output,JSON.stringify(report,null,2)+'\n');
await writeFile(output.replace(/\.json$/,'')+'-components.json',JSON.stringify(components,null,2)+'\n');
const counts={};for(const o of outcomes)counts[o.status]=(counts[o.status]||0)+1;
console.log(JSON.stringify({counts,componentCases:components.length,output}));
if(outcomes.some(o=>o.status==='failed'))process.exitCode=1;
