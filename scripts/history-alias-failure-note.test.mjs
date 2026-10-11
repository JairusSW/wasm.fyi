import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {aliasFailureNote} from './lib/history-alias-failure-note.mjs';
const encode=value=>Buffer.from(JSON.stringify(value));
function fixture(){
 const source={repository:'org/sdk',revision:'a'.repeat(40),asOf:'2026-10-09T08:00:00Z',kind:'snapshot',ref:'main@aaaaaaaaaaaa'};
 const original={capturedAt:'2026-10-10T01:00:00Z',source,platform:{arch:'amd64'},results:['compile','instantiate','first-call','steady'].map(phase=>({engine:'sdk-jit',workload:'tiny',phase,artifactSha256:'b'.repeat(64),contractSha256:'c'.repeat(64),latencyStatus:phase==='steady'?'failed':'ok',samplesNs:phase==='steady'?[]:[10,20]}))};
 const alias=structuredClone(original);alias.source.asOf='2026-10-04T10:00:00Z';
 const note={capturedAt:original.capturedAt,source,engine:'sdk-jit',workload:'tiny',kind:'failed-trials',phases:['steady'],reason:'actual guest trap',failures:[{phase:'steady',reason:'actual guest trap'}]};
 return {original,alias,note,args:{originalBytes:encode(original),originalPath:'/captures/original.json',originalNoteBytes:encode(note),originalNotePath:'/failure-notes/original.json',aliasBytes:encode(alias),aliasPath:'/captures/alias.json',expected:{repository:source.repository,revision:source.revision,originalAsOf:source.asOf,aliasAsOf:alias.source.asOf,configuration:'sdk-jit',workload:'tiny',artifactSha256:'b'.repeat(64),contractSha256:'c'.repeat(64)},linkedAt:'2026-10-10T02:00:00Z'}};
}
test('links exact original failure provenance without modifying captures, samples, or notes',()=>{
 const {args}=fixture(),before={...args,originalBytes:Buffer.from(args.originalBytes),aliasBytes:Buffer.from(args.aliasBytes),originalNoteBytes:Buffer.from(args.originalNoteBytes)};
 const derived=aliasFailureNote(args);assert.equal(derived.reason,'actual guest trap');assert.equal(derived.source.asOf,'2026-10-04T10:00:00Z');assert.equal(derived.capturedAt,'2026-10-10T01:00:00Z');assert.equal(derived.aliasedFromOriginalFailureNote,true);assert.match(derived.aliasOf.captureSha256,/^[a-f0-9]{64}$/);assert.deepEqual(args,before);
 derived.failures[0].reason='changed';assert.equal(aliasFailureNote(args).reason,'actual guest trap');
});
test('missing or mismatched original note blocks linkage instead of inventing a reason',()=>{
 const {args,note}=fixture();assert.throws(()=>aliasFailureNote({...args,originalNoteBytes:null}),/Missing original canonical/);
 for(const change of [{engine:'other'},{workload:'other'},{source:{...note.source,revision:'d'.repeat(40)}},{capturedAt:'other'},{reason:''}])assert.throws(()=>aliasFailureNote({...args,originalNoteBytes:encode({...note,...change})}),/Historical alias failure-note/);
 assert.throws(()=>aliasFailureNote({...args,originalNotePath:'/notes/different.json'}),/filename differs/);
});
test('wrong revision, backend configuration, artifact, or contract and changed measurements fail closed',()=>{
 const {args,alias}=fixture();for(const change of [{revision:'d'.repeat(40)},{aliasAsOf:'2026-09-27T10:00:00Z'},{configuration:'sdk-interpreter'},{workload:'other'},{artifactSha256:'d'.repeat(64)},{contractSha256:'d'.repeat(64)}])assert.throws(()=>aliasFailureNote({...args,expected:{...args.expected,...change}}),/differs/);
 const changed=structuredClone(alias);changed.results[0].samplesNs=[99];assert.throws(()=>aliasFailureNote({...args,aliasBytes:encode(changed)}),/measurement body differs/);
});
test('successful and unsupported aliases ignore stale failed notes',()=>{
 const {args,original,alias}=fixture();for(const status of ['ok','unsupported']){for(const capture of [original,alias])for(const row of capture.results)row.latencyStatus=status;assert.equal(aliasFailureNote({...args,originalBytes:encode(original),aliasBytes:encode(alias),originalNoteBytes:Buffer.from('not valid JSON')}),null);}
});
test('phase repairs keep only remaining original failure details and preserve the original reason',()=>{
 const {args,note}=fixture();note.phases=['compile','steady'];note.reason='resolved compile failure; actual guest trap';note.failures.unshift({phase:'compile',reason:'resolved compile failure'});const derived=aliasFailureNote({...args,originalNoteBytes:encode(note)});assert.deepEqual(derived.phases,['steady']);assert.equal(derived.reason,'actual guest trap');assert.equal(derived.originalReason,note.reason);assert.equal(derived.failures.length,1);
 note.failures=[];note.phases=[];assert.throws(()=>aliasFailureNote({...args,originalNoteBytes:encode(note)}),/lacks failed phase/);
});
test('recovered notes require the original capture hash and preserve recovery provenance without adding a budget',()=>{
 const {args,note}=fixture();delete note.capturedAt;note.reconstructedFromOriginalStatus=true;note.failedCapturePath=args.originalPath;note.failedCaptureSha256=createHash('sha256').update(args.originalBytes).digest('hex');note.originalStatusPath='/job/status.json';note.originalStatusSha256='d'.repeat(64);
 const derived=aliasFailureNote({...args,originalNoteBytes:encode(note)});assert.equal(derived.reconstructedFromOriginalStatus,true);assert.equal(Object.hasOwn(derived,'budgetMs'),false);assert.equal(derived.failedCaptureSha256,note.failedCaptureSha256);
 note.failedCaptureSha256='e'.repeat(64);assert.throws(()=>aliasFailureNote({...args,originalNoteBytes:encode(note)}),/not anchored/);
});
test('byte-identical mirrors preserve recorded origin paths while same-name different bodies are rejected',()=>{
 const {args,note,original,alias}=fixture();delete note.capturedAt;note.reconstructedFromOriginalStatus=true;note.failedCapturePath='/remote/captures/original.json';note.failedCaptureSha256=createHash('sha256').update(args.originalBytes).digest('hex');note.originalStatusPath='/remote/job/status.json';note.originalStatusSha256='d'.repeat(64);
 const mirrored={...args,originalPath:'/mirror/captures/original.json',originalNotePath:'/mirror/notes/original.json',originalNoteBytes:encode(note)};const derived=aliasFailureNote(mirrored);assert.equal(derived.aliasOf.capturePath,mirrored.originalPath);assert.equal(derived.aliasOf.recordedOriginCapturePath,note.failedCapturePath);
 original.platform.cpu='different machine';alias.platform.cpu='different machine';assert.throws(()=>aliasFailureNote({...mirrored,originalBytes:encode(original),aliasBytes:encode(alias)}),/not anchored/);
});
