import assert from 'node:assert/strict';
import {digest} from './wasmbench.mjs';
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const RECORDED=new Set(['collected','not-collected','pending-binding','unavailable','runner-error','building','running']);

// Publication-only replay is not a new collection attempt. Preserve the recorded
// outcome/reason and any incomplete attempt provenance instead of replacing it
// with a generic "not collected" value.
export function retainUncollectedHistoryConfiguration(previous,configuration){
 assert(ID.test(configuration),'Invalid historical configuration identity');
 if(previous!==undefined){assert(previous.id===configuration&&RECORDED.has(previous.status)&&previous.status!=='collected','Invalid uncollected historical state');return structuredClone(previous)}
 return {id:configuration,status:'not-collected',reason:'No verified completed report is available for publication-only replay.'};
}

function date(value){
 assert(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)&&Number.isFinite(Date.parse(value)),'Invalid historical coverage date');
 const day=value.slice(0,10);assert(!day.startsWith('0000-')&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day,'Invalid historical coverage calendar day');return day;
}
function build(pin){
 assert(pin&&ID.test(pin.engine),'Missing historical engine identity');
 const role=pin.targetType==='main'?'source':'release';
 const value={engine:pin.engine,role,repository:pin.repository??null,version:role==='release'?pin.tag??null:null,revision:pin.revision??null,sourceDate:pin.committedAt??null,releaseDate:role==='release'?pin.publishedAt??null:null,datePrecision:pin.datePrecision??null,url:pin.url??null};
 if(value.revision!==null)assert(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.revision),'Invalid historical build revision');
 if(value.sourceDate!==null)date(value.sourceDate);if(value.releaseDate!==null)date(value.releaseDate);
 if(value.datePrecision!==null)assert(['day','second'].includes(value.datePrecision),'Invalid historical date precision');
 if(value.url!==null){const url=new URL(value.url);assert(url.protocol==='https:'&&!url.username&&!url.password,'Invalid historical release URL')}
 for(const field of ['repository','version','url'])if(value[field]!==null)assert(typeof value[field]==='string'&&value[field].length<=2048,'Invalid historical build descriptor');
 return value;
}

// This projects queue/ledger assertions only. It never creates measurement rows,
// claims a report verified, or treats an absent ledger entry as unsupported.
// One row per exact queued configuration retains reused target aliases together.
export function* historicalCoverageRecords({queue,ledger,configured}){
 assert(queue&&HASH.test(queue.corpusSha256)&&HASH.test(queue.recipeSha256)&&typeof queue.host==='string'&&queue.host.length<=128&&Array.isArray(queue.jobs),'Invalid historical coverage scope');
 assert(ledger&&Array.isArray(ledger.jobs),'Invalid historical results ledger');
 assert(Array.isArray(configured)&&configured.every(value=>ID.test(value)),'Invalid historical collection scope');
 const enabled=new Set(configured),states=new Map(),jobs=new Set();
 for(const state of ledger.jobs){assert(HASH.test(state.id)&&!states.has(state.id)&&Array.isArray(state.configurations),'Duplicate or invalid history ledger job');const entries=new Map();for(const entry of state.configurations){assert(ID.test(entry.id)&&RECORDED.has(entry.status)&&!entries.has(entry.id),'Duplicate or invalid history ledger configuration');entries.set(entry.id,entry)}states.set(state.id,entries)}
 for(const job of queue.jobs){
  assert(HASH.test(job.id)&&!jobs.has(job.id)&&Array.isArray(job.identity?.configurations),'Duplicate or invalid historical queue job');jobs.add(job.id);
  const targetDates=[...new Set([...(job.targetWeeks??[]),...(job.targetReleases??[]).map(release=>release.publishedAt)].map(date))].sort();assert(targetDates.length>0&&targetDates.length<=256,'Historical coverage aliases exceed bounds');
  const desiredBuild=build(job.release),seen=new Set();
  for(const configuration of job.identity.configurations){
   assert(ID.test(configuration)&&!seen.has(configuration),'Duplicate or invalid historical requested configuration');seen.add(configuration);
   const entry=states.get(job.id)?.get(configuration),inScope=enabled.has(configuration),recordedStatus=entry?.status??null;
   const status=recordedStatus===null||recordedStatus==='not-collected'?'uncollected':recordedStatus;
   const reason=entry?.reason??(entry?null:inScope?'No recorded collection entry.':'Outside configured collection scope.');assert(reason===null||(typeof reason==='string'&&Buffer.byteLength(reason)<=2048),'Invalid historical coverage reason');
   const collected=recordedStatus==='collected';if(collected)assert(HASH.test(entry.sha256)&&entry.collectedAt&&Number.isFinite(Date.parse(entry.collectedAt)),'Collected historical state lacks its source identity/time');
   const publication=entry?.apiPublication;
   if(publication?.status==='published')assert(collected&&HASH.test(publication.revision),'Published history coverage lacks a completed source');
   const coverageId=digest(Buffer.from(JSON.stringify(['history-coverage-v1',queue.host,queue.corpusSha256,queue.recipeSha256,job.id,configuration])));
   const observedSourceRevision=collected?entry.binding?.source?.revision??null:null;if(observedSourceRevision!==null)assert(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(observedSourceRevision),'Invalid observed historical revision');
   const data={schema:1,coverageId,targetType:job.release.targetType??'weekly',policy:'recorded-history-coverage-v1',host:queue.host,corpusSha256:queue.corpusSha256,recipeSha256:queue.recipeSha256,jobId:job.id,configuration,targetDates,desiredBuild,configured:inScope,status,recordedStatus,reason,observedSourceRevision,sourceReportSha256:collected?entry.sha256:null,collectedAt:collected?entry.collectedAt:null,publishedRevision:publication?.status==='published'?publication.revision:null,interpretationSource:'trusted-publisher-assertion'};
   const bytes=Buffer.from(JSON.stringify(data));assert(bytes.length+512<=10*1024,'Historical coverage descriptor exceeds budget');yield {kind:'history-coverage',id:digest(bytes),data};
  }
 }
 // Pins with no resolved release/source never create a queued measurement job.
 // Their configuration is explicitly unknown when the planner did not record it.
 const missing=new Set();
 for(const pin of queue.snapshots??[]){
  if(pin.jobId)continue;
  assert(pin.status==='unavailable','Unresolved history pin has an unknown state');
  const isRelease=pin.targetType==='release',targetRelease=isRelease?pin.targetRelease??pin.tag??null:null;
  const targetDate=isRelease?(pin.publishedAt===undefined?null:date(pin.publishedAt)):date(pin.targetWeek);
  assert(targetDate!==null||(typeof targetRelease==='string'&&targetRelease.length>0&&targetRelease.length<=256),'Unavailable release has no target identity');
  const desiredBuild=build(pin),key=JSON.stringify([pin.engine,pin.targetType??'weekly',targetDate,targetRelease]);assert(!missing.has(key),'Duplicate unavailable history target');missing.add(key);
  const configurations=pin.configurations?.length?pin.configurations:[null];
  const seen=new Set();for(const configuration of configurations){
   assert((configuration===null||ID.test(configuration))&&!seen.has(configuration),'Invalid unavailable configuration scope');seen.add(configuration);
   const coverageId=digest(Buffer.from(JSON.stringify(['history-unavailable-v1',queue.host,queue.corpusSha256,queue.recipeSha256,key,configuration])));
   const reason=pin.reason??'No resolved build was available for this target.';assert(typeof reason==='string'&&Buffer.byteLength(reason)<=2048,'Invalid unavailable history reason');
   const data={schema:1,coverageId,targetType:pin.targetType??'weekly',policy:'recorded-history-coverage-v1',host:queue.host,corpusSha256:queue.corpusSha256,recipeSha256:queue.recipeSha256,jobId:null,configuration,targetDates:targetDate===null?[]:[targetDate],targetRelease,desiredBuild,configured:configuration===null?null:enabled.has(configuration),status:'unavailable',recordedStatus:'unavailable',reason,observedSourceRevision:null,sourceReportSha256:null,collectedAt:null,publishedRevision:null,interpretationSource:'trusted-publisher-assertion'};
   const bytes=Buffer.from(JSON.stringify(data));assert(bytes.length+512<=10*1024,'Historical coverage descriptor exceeds budget');yield {kind:'history-coverage',id:digest(bytes),data};
  }
 }
}
