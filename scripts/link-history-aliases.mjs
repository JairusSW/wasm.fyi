import {historyPinAllowed} from './lib/history-window.mjs';
import {readFile,readdir,mkdir,writeFile,link,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {aliasCapture} from './lib/history-alias.mjs';
import {aliasFailureNote} from './lib/history-alias-failure-note.mjs';
import {atomicJSON,readCache} from './lib/benchmark-plan.mjs';
import {workloadContract} from './lib/workload-contract.mjs';
import {digest} from './lib/wasmbench.mjs';
const root=resolve(process.argv[2]);
const plan=JSON.parse(await readFile(join(root,'source-plan.json')));
const template=JSON.parse(await readFile(join(root,'collection-template.json')));
const workloads=new Map((await readCache(template.corpusRoot)).map(w=>[w.id,w]));
const eligiblePins=plan.pins.filter(pin=>historyPinAllowed(pin,template));
const directory=join(root,'captures'),notes=join(root,'failure-notes');
const files=(await readdir(directory).catch(()=>[])).filter(name=>name.endsWith('.json')&&!name.startsWith('alias-'));
const optional=path=>readFile(path).catch(error=>{if(error.code==='ENOENT')return null;throw error});
const captureIdentity=(source,row)=>JSON.stringify([source?.repository,source?.revision,source?.asOf,row?.engine,row?.workload,row?.artifactSha256,row?.contractSha256]);
const originals=await Promise.all(files.map(async name=>{const path=join(directory,name),bytes=await readFile(path);return{name,path,bytes,capture:JSON.parse(bytes)}}));
// A real capture at the alias target wins over reuse. This matters when an
// unchanged runtime revision spans a corpus-contract change: the unaffected
// workloads can still be aliased while the changed workloads are recaptured.
const genuineCaptures=new Set(originals.flatMap(({capture})=>capture.results?.map(row=>captureIdentity(capture.source,row))||[]));
// Linking a fully written private inode is atomic and cannot replace any existing file.
async function publishMissing(path,bytes){await mkdir(dirname(path),{recursive:true});const temporary=path+'.tmp-'+randomUUID();await writeFile(temporary,bytes,{flag:'wx'});try{await link(temporary,path);return true}catch(error){if(error.code==='EEXIST')return false;throw error}finally{await unlink(temporary)}}
let linked=0,notesLinked=0,notesExisting=0;const errors=[];
for(const {name,path:originalPath,bytes:originalBytes,capture:original} of originals){
 for(const pin of eligiblePins){
  const copy=aliasCapture(original,pin);if(!copy)continue;
  const targetName='alias-'+digest(Buffer.from(name+'|'+pin.targetWeek+'|'+(pin.tag||pin.revision)))+'.json',target=join(directory,targetName);
  try{
   let aliasBytes=await optional(target);
   const row=original.results?.[0],workload=workloads.get(row?.workload);if(!workload)throw Error('Frozen workload is missing: '+row?.workload);
   if(genuineCaptures.has(captureIdentity({repository:pin.repository,revision:pin.revision,asOf:pin.targetWeek},{engine:row.engine,workload:workload.id,artifactSha256:workload.sha256,contractSha256:workloadContract(workload)})))continue;
   const notePath=join(notes,name),targetNote=join(notes,targetName),existingBytes=await optional(targetNote);
   const existing=existingBytes?JSON.parse(existingBytes):null;
   const expectedIdentity={repository:pin.repository,revision:pin.revision,originalAsOf:pin.reuseTargetWeek,aliasAsOf:pin.targetWeek,configuration:row.engine,workload:workload.id,artifactSha256:workload.sha256,contractSha256:workloadContract(workload)};
   const originalNoteBytes=await optional(notePath);
   if(!aliasBytes){const bytes=Buffer.from(JSON.stringify(copy,null,2)+'\n');const candidateNote=aliasFailureNote({originalBytes,originalPath,originalNoteBytes,originalNotePath:notePath,aliasBytes:bytes,aliasPath:target,linkedAt:existing?.linkedAt||new Date().toISOString(),expected:expectedIdentity});if(existingBytes&&!isDeepStrictEqual(existing,candidateNote))throw Error('Orphan existing alias note conflicts with candidate provenance');if(await publishMissing(target,bytes)){linked++;aliasBytes=bytes}else aliasBytes=await readFile(target)}
   const derived=aliasFailureNote({originalBytes,originalPath,originalNoteBytes,originalNotePath:notePath,aliasBytes,aliasPath:target,linkedAt:existing?.linkedAt||new Date().toISOString(),expected:{repository:pin.repository,revision:pin.revision,originalAsOf:pin.reuseTargetWeek,aliasAsOf:pin.targetWeek,configuration:row.engine,workload:workload.id,artifactSha256:workload.sha256,contractSha256:workloadContract(workload)}});
   if(!derived){if(existingBytes)throw Error('Stale failure note exists for successful/unsupported alias');continue}
   if(existingBytes){if(!isDeepStrictEqual(existing,derived))throw Error('Existing alias note conflicts with canonical provenance');notesExisting++;continue}
   const bytes=Buffer.from(JSON.stringify(derived,null,2)+'\n');
   if(await publishMissing(targetNote,bytes))notesLinked++;
   else{const raced=JSON.parse(await readFile(targetNote));const expected=aliasFailureNote({originalBytes,originalPath,originalNoteBytes,originalNotePath:notePath,aliasBytes,aliasPath:target,linkedAt:raced.linkedAt,expected:derived.aliasOf});if(!isDeepStrictEqual(raced,expected))throw Error('Concurrent alias note publication conflicts');notesExisting++}
  }catch(error){errors.push({originalPath,aliasPath:target,source:pin.revision,asOf:pin.targetWeek,code:error.code||'WASMFYI_ALIAS_FAILURE_NOTE',error:String(error)})}
 }
}
const report={checkedAt:new Date().toISOString(),linked,notesLinked,notesExisting,errors,status:errors.length?'needs-integration-repair':'complete'};await atomicJSON(join(root,'alias-failure-note-audit.json'),report);console.log(JSON.stringify(report));if(errors.length)process.exitCode=1;
