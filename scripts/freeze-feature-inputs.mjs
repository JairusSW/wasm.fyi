// Freeze source-built feature contracts into a portable, content-addressed input set.
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {basename, isAbsolute, join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {site} from './lib/wasmbench.mjs';

const output=resolve(process.argv[2]||join(site,'.wasmbench/feature-inputs-current'));
const performanceRoot=resolve(process.argv[3]||join(site,'.wasmbench/feature-performance-current'));
const corpusRoot=join(site,'corpora/features');
const read=path=>readFile(path,'utf8').then(JSON.parse);
const digest=value=>createHash('sha256').update(value).digest('hex');
await rm(output,{recursive:true,force:true});
await mkdir(join(output,'artifacts'),{recursive:true});
await mkdir(join(output,'sources'),{recursive:true});

async function freeze(workload,root){
 const artifact=isAbsolute(workload.artifact)?workload.artifact:join(root,workload.artifact);
 const bytes=await readFile(artifact);
 if(digest(bytes)!==workload.sha256)throw Error(`Artifact digest mismatch: ${workload.id}`);
 const artifactName=`artifacts/${workload.sha256}.wasm`;
 await writeFile(join(output,artifactName),bytes,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error});
 let sourceName;
 if(workload.source){
  const source=isAbsolute(workload.source)?workload.source:join(root,workload.source);
  const sourceBytes=await readFile(source);
  sourceName=`sources/${digest(sourceBytes)}${basename(source).endsWith('.wat')?'.wat':'.txt'}`;
  await writeFile(join(output,sourceName),sourceBytes,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error});
 }
 return {...workload,artifact:artifactName,...(sourceName?{source:sourceName}:{})};
}

const manifest=await read(join(corpusRoot,'manifest.json'));
const compatibility=[];
for(const workload of manifest){
 const scope=workload.provenance?.scope;
 if(!['compile-only','compile-and-instantiate'].includes(scope)&&(workload.reset==='stateless'||workload.abi==='component'))compatibility.push(await freeze(workload,corpusRoot));
}
const performance=[];
for(const workload of await read(join(performanceRoot,'manifest.json')))performance.push(await freeze(workload,performanceRoot));
const compile=[];
for(const workload of await read(join(performanceRoot,'compile-probes.json')))compile.push(await freeze(workload,corpusRoot));
const lifecycle=[];
for(const workload of await read(join(performanceRoot,'lifecycle-probes.json')))lifecycle.push(await freeze(workload,corpusRoot));
for(const [name,rows]of Object.entries({compatibility,performance,compile,lifecycle}))await writeFile(join(output,`${name}.json`),JSON.stringify(rows,null,2)+'\n');
const identity={schema:1,createdAt:new Date().toISOString(),counts:{compatibility:compatibility.length,performance:performance.length,compile:compile.length,lifecycle:lifecycle.length},manifests:Object.fromEntries(await Promise.all(Object.entries({compatibility,performance,compile,lifecycle}).map(async([name,rows])=>[name,digest(Buffer.from(JSON.stringify(rows)))])))};
await writeFile(join(output,'identity.json'),JSON.stringify(identity,null,2)+'\n');
console.log(JSON.stringify(identity));
