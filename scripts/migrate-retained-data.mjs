import assert from 'node:assert/strict';
import {retainedHistoryBindings} from './lib/retained-history-bindings.mjs';
import {readFile,writeFile,mkdir,rm,stat,statfs,glob} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
const execute=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex'),encode=v=>Buffer.from(JSON.stringify(v));
let stopping=false,stopCode=0;
process.once('SIGINT',()=>{stopping=true;stopCode=130});
process.once('SIGTERM',()=>{stopping=true;stopCode=143});
const [dataRoot,inventoryFile='.wasmbench/retained-api-inventory.json',limitText='']=process.argv.slice(2);
assert(dataRoot,'Usage: node scripts/migrate-retained-data.mjs DATA_DIRECTORY [INVENTORY] [REPORT_LIMIT]');
const run=resolve('.wasmbench/retained-migration-'+hash(Buffer.from(resolve(dataRoot))).slice(0,12)),temporary=join(run,'pending'),checkpoint=join(run,'checkpoint.json');await mkdir(run,{recursive:true});
const inventory=JSON.parse(await readFile(inventoryFile));
const descriptors=new Map();
for(const name of ['wasmbench','history','history-hub']){const root=resolve('data',name),index=JSON.parse(await readFile(join(root,'index.json')));for(const item of index.reports)descriptors.set(root+'/'+item.id,item)}
const bindings=new Map();
for(const name of ['history','history-hub']){
 const root=resolve('data',name),weekly=JSON.parse(await readFile(join(root,'weekly.json')));
 for(const id of weekly.baseline?.reports||[]){const legacy=JSON.parse(await readFile(join(root,id+'.json')));let rows=bindings.get(id);if(!rows)bindings.set(id,rows=[]);for(const runtime of legacy.runtimes)for(const date of weekly.weeks){const row={runtime:runtime.id,date:date.slice(0,10),role:'fixed-baseline'};if(!rows.some(r=>JSON.stringify(r)===JSON.stringify(row)))rows.push(row)}}
 const sources=inventory.reports.map(r=>({...r,oldId:r.path.split('/').pop().slice(0,-5)}));
 for(const [id,rows] of retainedHistoryBindings(weekly,sources)){
  const previous=bindings.get(id)||[];bindings.set(id,[...previous,...rows]);
 }
}
let state={schema:1,reports:{},parents:{},started:new Date().toISOString()};try{state=JSON.parse(await readFile(checkpoint))}catch(e){if(e.code!=='ENOENT')throw e}
const save=async()=>{await writeFile(checkpoint+'.tmp',JSON.stringify(state));const {rename}=await import('node:fs/promises');await rename(checkpoint+'.tmp',checkpoint)};
await mkdir(resolve(dataRoot),{recursive:true});
const writer=spawn(resolve('.wasmbench/import-retained'),['--data',resolve(dataRoot)],{stdio:['pipe','pipe','inherit'],env:{...process.env,GOMAXPROCS:'2'}});
const output=createInterface({input:writer.stdout});const answers=output[Symbol.asyncIterator]();let writerFailure;
writer.on('exit',code=>{if(code!==0)writerFailure=Error('Offline importer exited '+code)});
const completed=new Promise(resolve=>writer.on('exit',resolve));
async function binaryFile(directory,objects,reportId,name,bytes,media='application/json'){
 const chunks=[];
 for(let start=0;start<bytes.length;start+=1024*1024){const body=bytes.subarray(start,start+1024*1024),id=hash(body);await writeFile(join(directory,'objects',id),body);if(!objects.some(o=>o.sha256===id))objects.push({sha256:id,bytes:body.length,kind:'binary'});chunks.push({sha256:id,bytes:body.length})}
 const data={schema:1,kind:'report-file',reportId,name,mediaType:media,encoding:'identity',sha256:hash(bytes),bytes:bytes.length,chunks};const id=hash(encode(data)),body=encode({kind:'report-file',id,data}),digest=hash(body);await writeFile(join(directory,'objects',digest),body);objects.push({sha256:digest,bytes:body.length,kind:'record'});
}
let pendingParents=new Set(),pendingDatasets=new Set();
async function augment(source,directory,extraFiles=[]){
 const original=await readFile(source.path),descriptor=descriptors.get(resolve(dirname(source.path))+'/'+source.oldId);assert.equal(hash(original),descriptor.evidenceSha256,'Retained site report changed');
 const legacy=JSON.parse(original);assert.equal(legacy.sourceReportSealed,true,'Retained source was not recorded as sealed');const manifest=JSON.parse(await readFile(join(directory,'manifest.json'))),objects=[...manifest.objects];
 for(const page of manifest.inventoryPages||[]){const bytes=await readFile(join(directory,'objects',page.sha256));assert.equal(hash(bytes),page.sha256);objects.push(...JSON.parse(bytes).objects)}
 await binaryFile(directory,objects,manifest.reportId,'retained-site-report.json',original);
 for(const [field,name] of [['trialsEvidence','retained-trials.json'],['throughputEvidence','retained-throughput.json']])if(legacy[field]){const bytes=await readFile(join(dirname(source.path),legacy[field]));const digest=field==='trialsEvidence'?legacy.trialsSha256:legacy.throughputSha256;assert.equal(hash(bytes),digest);await binaryFile(directory,objects,manifest.reportId,name,bytes)}
 for(const [file,name] of [['data.json','retained-producer-data.json'],['checksums.json','retained-producer-checksums.json'],['wasm-fyi-export.json','retained-receipt.json']]){try{await binaryFile(directory,objects,manifest.reportId,name,await readFile(join(source.producerProjection||source.sealedReport,file)))}catch(e){if(e.code!=='ENOENT')throw e}}
 let parentKey;
 if(source.bundle){parentKey=source.bundle.id+'/'+source.bundle.machine;if(!state.parents[parentKey]&&!pendingParents.has(parentKey)){pendingParents.add(parentKey);
  const root=resolve('data/benchmark-runs',source.bundle.id,source.bundle.machine,'bundle'),indexBytes=await readFile(join(root,'index.json')),index=JSON.parse(indexBytes),metadata=await readFile(join(root,index.metadata));assert.equal(hash(metadata),index.metadataSha256);
  const parts=[];for(const part of index.parts){const bytes=await readFile(join(root,part.path));assert.equal(bytes.length,part.bytes);assert.equal(hash(bytes),part.sha256);parts.push(bytes)}
  const archive=Buffer.concat(parts);assert.equal(archive.length,index.bytes);assert.equal(hash(archive),index.sha256);
  await binaryFile(directory,objects,manifest.reportId,'retained-parent.tar.gz',archive,'application/gzip');await binaryFile(directory,objects,manifest.reportId,'retained-parent-index.json',indexBytes);await binaryFile(directory,objects,manifest.reportId,'retained-parent-metadata.json',metadata);
 }}
 const datasetKey=source.dataset;
 if(!state.datasets?.[datasetKey]&&!pendingDatasets.has(datasetKey)){pendingDatasets.add(datasetKey);await binaryFile(directory,objects,manifest.reportId,'retained-index.json',await readFile(join(dirname(source.path),'index.json')));if(datasetKey!=='wasmbench')await binaryFile(directory,objects,manifest.reportId,'retained-history.json',await readFile(join(dirname(source.path),'weekly.json')));else await binaryFile(directory,objects,manifest.reportId,'retained-catalog.json',await readFile(resolve('corpora/catalog.json')))}
 for(const file of extraFiles)await binaryFile(directory,objects,manifest.reportId,file.name,file.bytes);
 const configRecords=[];
 for(const object of objects)if(object.kind==='record'){const record=JSON.parse(await readFile(join(directory,'objects',object.sha256)));if(record.kind==='configuration')configRecords.push(record)}
 const history=[];
 for(const row of bindings.get(source.oldId)||[]){const configuration=configRecords.find(r=>r.data.id===row.runtime);assert(configuration,'Historical exact configuration missing');const binding={reportId:manifest.reportId,configurationId:configuration.id,policy:'declared-build-history-v1',targetDate:row.date,...(row.sourceDate?{sourceDate:row.sourceDate}:{}),...(row.revision?{sourceRevision:row.revision}:{}),buildRole:row.role,...(row.release?{release:row.release}:{})};if(!history.some(h=>JSON.stringify(h)===JSON.stringify(binding)))history.push(binding)}
 const grouped=new Map();for(const binding of history){const {targetDate,...identity}=binding,key=JSON.stringify(identity);let value=grouped.get(key);if(!value)grouped.set(key,value={...identity,targetDates:[]});if(!value.targetDates.includes(targetDate))value.targetDates.push(targetDate)}for(const value of grouped.values())value.targetDates.sort();history.splice(0,history.length,...grouped.values());
 // Keep original producer record bytes. Only new file descriptors and inventory
 // commitments are added; source scientific records never pass through JS.
 manifest.objects=[];delete manifest.inventoryPages;
 const unique=[...new Map(objects.map(o=>[o.sha256,o])).values()];
 manifest.inventoryPages=[];{for(let start=0;start<unique.length;start+=512){const items=unique.slice(start,start+512),bytes=encode({schema:1,objects:items}),sha256=hash(bytes);await writeFile(join(directory,'objects',sha256),bytes);manifest.inventoryPages.push({sha256,bytes:bytes.length,objects:items.length,contentBytes:items.reduce((n,o)=>n+o.bytes,0)})}}
 // Match the serving wire's canonical manifest field order.
 const ordered=Object.fromEntries(['schema','format','reportId','sourceReportSha256','sourceSealSha256','exporter','verification','objects','inventoryPages','exporterIdentity'].filter(k=>manifest[k]!==undefined).map(k=>[k,manifest[k]]));
 const bytes=encode(ordered);await writeFile(join(directory,'manifest.json'),bytes);
 return {export:{sha256:hash(bytes),manifest:ordered},history,parentKey,legacyId:source.oldId,reportId:manifest.reportId,datasetKey};
}
let reports=inventory.reports.map(r=>({...r,oldId:r.path.split('/').pop().slice(0,-5)})).sort((a,b)=>(a.dataset==='wasmbench'?0:1)-(b.dataset==='wasmbench'?0:1)||a.created.localeCompare(b.created)||a.oldId.localeCompare(b.oldId));
if(limitText)reports=reports.slice(0,Number(limitText));
try{
 for(let start=0;start<reports.length;){
  if(stopping)break;
  const batch=[],role=reports[start].dataset==='wasmbench'?'retained-measurement':'retained-history';
  while(start<reports.length&&batch.length<64&&(reports[start].dataset==='wasmbench'?'retained-measurement':'retained-history')===role){const source=reports[start++];if(!state.reports[source.oldId])batch.push(source)}
  if(!batch.length)continue;
  const capacity=await statfs(resolve(dataRoot));assert(capacity.bavail*capacity.bsize>8*1024**3,'Migration stops below 8 GiB free space; source evidence is preserved');
  await rm(temporary,{recursive:true,force:true});await mkdir(temporary,{recursive:true});const prepared=[],directories=[];pendingParents=new Set();pendingDatasets=new Set();
  const batchStarted=Date.now();let nextExport=0;
  await Promise.all(Array.from({length:Math.min(4,batch.length)},async()=>{
   while(nextExport<batch.length){const index=nextExport++,source=batch[index],directory=join(temporary,String(index));assert(source.producerProjection||source.sealedReport,'No retained producer source for '+source.oldId);
    await execute(resolve('.wasmbench/retained-exporter'),['export-retained-site','--report',source.producerProjection||source.sealedReport,'--out',directory],{env:{...process.env,GOMAXPROCS:'2'},maxBuffer:1024*1024});
   }
  }));
  for(const [index,source] of batch.entries()){const directory=join(temporary,String(index));prepared.push(await augment(source,directory));directories.push(directory)}
  const preparedSeconds=(Date.now()-batchStarted)/1000;
  const plan=hash(encode(['retained-data-migration-v1',batch.map(r=>r.oldId)]));
  const job={schema:3,kind:role,session:'retained-'+plan.slice(0,32),machine:'archive',corpus:'batch',attempt:plan,plan,status:'completed',exports:prepared.map(p=>p.export),...(prepared.some(p=>p.history.length)?{history:prepared.flatMap(p=>p.history)}:{})};
  if(writerFailure)throw writerFailure;writer.stdin.write(JSON.stringify({job,directories})+'\n');const response=await answers.next();assert(!response.done,'Offline importer stopped');const receipt=JSON.parse(response.value);
  for(const item of prepared){state.datasets ||= {};state.datasets[item.datasetKey] ||= {reportId:item.reportId,revision:receipt.revision};state.reports[item.legacyId]={reportId:item.reportId,revision:receipt.revision,importId:receipt.id};if(item.parentKey&&!state.parents[item.parentKey])state.parents[item.parentKey]={reportId:item.reportId,revision:receipt.revision}}
  state.revision=receipt.revision;state.updated=new Date().toISOString();await save();await rm(temporary,{recursive:true,force:true});console.log(JSON.stringify({completed:Object.keys(state.reports).length,total:reports.length,prunedIndexPages:receipt.prunedIndexPages||0,preparedSeconds,batchSeconds:(Date.now()-batchStarted)/1000,revision:receipt.revision}));
 }
 if(!limitText&&!stopping&&!state.metadataRevision){
  const source=reports[0],directory=join(temporary,'metadata');await rm(temporary,{recursive:true,force:true});await mkdir(temporary,{recursive:true});
  await execute(resolve('.wasmbench/retained-exporter'),['export-retained-site','--report',source.producerProjection||source.sealedReport,'--out',directory],{env:{...process.env,GOMAXPROCS:'2'},maxBuffer:1024*1024});
  const files=[];for await(const path of glob(['data/*.json','data/benchmark-runs/*/*/plan.json'])){const bytes=await readFile(path);files.push({path,sha256:hash(bytes),bytes:bytes.length,content:JSON.parse(bytes)})}files.sort((a,b)=>a.path.localeCompare(b.path));
  const extras=[{name:'retained-site-metadata.json',bytes:encode({schema:1,files})},{name:'retained-migration-map.json',bytes:encode({schema:1,reports:state.reports,parents:state.parents,datasets:state.datasets})}];
  pendingParents=new Set();pendingDatasets=new Set();const prepared=await augment(source,directory,extras),plan=hash(encode(['retained-metadata-v1',extras.map(f=>hash(f.bytes))]));
  const job={schema:3,kind:'retained-history',session:'retained-'+plan.slice(0,32),machine:'archive',corpus:'metadata',attempt:plan,plan,status:'completed',exports:[prepared.export]};
  writer.stdin.write(JSON.stringify({job,directories:[directory]})+'\n');const response=await answers.next();assert(!response.done,'Offline importer stopped');const receipt=JSON.parse(response.value);state.metadataRevision=receipt.revision;state.metadataReportId=prepared.reportId;state.revision=receipt.revision;await save();await rm(temporary,{recursive:true,force:true});console.log(JSON.stringify({metadataFiles:files.length,revision:receipt.revision}));
 }
 writer.stdin.end();assert.equal(await completed,0);state.complete=Object.keys(state.reports).length===inventory.reports.length&&!!state.metadataRevision;await save();if(stopping)process.exitCode=stopCode;
}catch(error){writer.stdin.destroy();writer.kill('SIGTERM');throw error}
