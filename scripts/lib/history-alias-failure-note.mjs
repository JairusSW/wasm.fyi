import {createHash} from 'node:crypto';
import {basename} from 'node:path';
import {isDeepStrictEqual} from 'node:util';

const phases=['compile','instantiate','first-call','steady'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function reject(reason){const error=Error('Historical alias failure-note linkage: '+reason);error.code='WASMFYI_ALIAS_FAILURE_NOTE';throw error;}
function parse(bytes,label){try{return JSON.parse(bytes.toString())}catch{reject('Invalid '+label)}}

// All identities come from actual file bytes and the frozen workload catalog.
// No capture, original note, or input object is modified.
export function aliasFailureNote({originalBytes,originalPath,originalNoteBytes,originalNotePath,aliasBytes,aliasPath,expected,linkedAt}){
 if(typeof originalPath!=='string'||!originalPath||typeof aliasPath!=='string'||!aliasPath)reject('Missing capture file provenance');
 const original=parse(originalBytes,'original capture'),alias=parse(aliasBytes,'alias capture');
 const source=original.source,rows=original.results;
 if(!source||!Array.isArray(rows)||rows.length!==4||!expected)reject('Missing original identity');
 if(source.repository!==expected.repository||source.revision!==expected.revision||source.asOf!==expected.originalAsOf)reject('Original source differs from expected source');
 if(!/^[a-f0-9]{40}$/.test(source.revision)||!Number.isFinite(Date.parse(source.asOf)))reject('Unqualified original source');
 for(const phase of phases){
  const row=rows.find(row=>row.phase===phase);
  if(!row||row.engine!==expected.configuration||row.workload!==expected.workload||row.artifactSha256!==expected.artifactSha256||row.contractSha256!==expected.contractSha256)reject('Original workload/configuration/artifact/contract differs');
  if(!['ok','unsupported','failed'].includes(row.latencyStatus))reject('Original phase is not terminal');
 }
 if(alias.source?.repository!==source.repository||alias.source?.revision!==source.revision||alias.source?.asOf!==expected.aliasAsOf||alias.source?.asOf===source.asOf||!Number.isFinite(Date.parse(alias.source?.asOf)))reject('Alias source differs');
 const stableSource=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['asOf','kind','ref','dateBasis'].includes(key)));
 if(!isDeepStrictEqual(stableSource(source),stableSource(alias.source)))reject('Alias changes non-weekly source provenance');
 const {source:ignoredOriginal,...originalMeasurements}=original,{source:ignoredAlias,...aliasMeasurements}=alias;
 if(!isDeepStrictEqual(originalMeasurements,aliasMeasurements))reject('Alias measurement body differs from original');
 const failed=rows.filter(row=>row.latencyStatus==='failed').map(row=>row.phase);
 // A stale note never attaches to a successful or unsupported capture.
 if(!failed.length)return null;
 if(!originalNoteBytes)reject('Missing original canonical failure note');
 if(basename(originalPath)!==basename(originalNotePath||''))reject('Original canonical note filename differs');
 const note=parse(originalNoteBytes,'original failure note');
 if(!isDeepStrictEqual(note.source,source)||note.engine!==expected.configuration||note.workload!==expected.workload)reject('Original note source/configuration/workload differs');
 if(note.reconstructedFromOriginalStatus){
  if(note.failedCaptureSha256!==hash(originalBytes)||typeof note.failedCapturePath!=='string'||basename(note.failedCapturePath)!==basename(originalPath)||!note.originalStatusPath||!/^[a-f0-9]{64}$/.test(note.originalStatusSha256||''))reject('Recovered original note is not anchored to this capture');
 }else if(note.capturedAt!==original.capturedAt)reject('Original note measurement timestamp differs');
 if(!(typeof note.reason==='string'&&note.reason.trim()))reject('Missing original failure reason');
 if(Array.isArray(note.phases)&&failed.some(phase=>!note.phases.includes(phase)))reject('Original note lacks failed phase');
 let remaining=null;
 if(Array.isArray(note.failures)&&note.failures.length){
  remaining=note.failures.filter(failure=>failed.includes(failure.phase));
  if(failed.some(phase=>!remaining.some(failure=>failure.phase===phase&&typeof failure.reason==='string'&&failure.reason.trim())))reject('Original note lacks failed phase details');
 }
 if(!linkedAt||!Number.isFinite(Date.parse(linkedAt)))reject('Missing linkage timestamp');
 const derived=structuredClone(note);
 derived.source=alias.source;
 derived.phases=failed;
 if(remaining){derived.failures=structuredClone(remaining);derived.reason=remaining.map(failure=>failure.reason).join('; ');derived.originalReason=note.reason;}
 derived.aliasedFromOriginalFailureNote=true;
 derived.linkedAt=linkedAt;
 derived.aliasCapturePath=aliasPath;
 derived.aliasCaptureSha256=hash(aliasBytes);
 derived.aliasOf={capturePath:originalPath,captureSha256:hash(originalBytes),...(note.failedCapturePath?{recordedOriginCapturePath:note.failedCapturePath}:{}),notePath:originalNotePath,noteSha256:hash(originalNoteBytes),source:structuredClone(source),...expected};
 return derived;
}
