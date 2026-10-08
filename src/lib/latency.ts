import type {Result,PlatformChoice,BenchmarkPage} from './api/benchmark-types';
export type LatencyPhase=Result['phase'];
export type LatencyRow=Result;
export type LatencyPlatform=PlatformChoice;
export type LatencyPage=BenchmarkPage;

export const engineVersionKey=(row:Pick<LatencyRow,'engine'|'version'|'backend'> & Partial<Pick<LatencyRow,'source'>>)=>JSON.stringify([row.engine,row.version,row.backend,row.source?.revision.match(/^[a-f0-9]{40}(?=\/|$)/i)?.[0]||row.source?.revision||'',row.source?.asOf||'']);
// Preserve the producer's nanosecond ordering when timestamps share a millisecond.
const captureTimeCompare=(a:string,b:string)=>Date.parse(a)-Date.parse(b)||Number((a.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1]||'').slice(3,9).padEnd(6,'0'))-Number((b.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1]||'').slice(3,9).padEnd(6,'0'));
export function engineVersions(rows:LatencyRow[]) {
 const engines=new Map<string,Map<string,{key:string;version:string;backend:string;capturedAt:string;qualified:boolean}>>();
 for(const row of rows){const key=engineVersionKey(row);if(!engines.has(row.engine))engines.set(row.engine,new Map());const configs=engines.get(row.engine)!;const current=configs.get(key);if(!current||captureTimeCompare(row.source?.asOf||row.capturedAt,current.capturedAt)>0)configs.set(key,{key,version:row.version,backend:row.backend,capturedAt:row.source?.asOf||row.capturedAt,qualified:!!row.source&&(row.source.kind!=='current'||/^[a-f0-9]{40}(?:\/|$)/i.test(row.source.revision))})}
 return new Map([...engines].map(([id,configs])=>[id,[...configs.values()].sort((a,b)=>Number(b.qualified)-Number(a.qualified)||captureTimeCompare(b.capturedAt,a.capturedAt)||a.key.localeCompare(b.key))]));
}
export function selectEngineVersions(rows:LatencyRow[],selected:Record<string,string>={}) {
 const versions=engineVersions(rows),chosen=new Map([...versions].map(([id,configs])=>[id,configs.find(c=>c.key===selected[id])?.key||configs[0].key]));
 return rows.filter(row=>engineVersionKey(row)===chosen.get(row.engine));
}
export function codeSizeLabel(kind:LatencyRow['codeKind']|undefined) {
 return kind==='native-image'?'Native image':kind==='engine-reported'?'Engine-reported code':kind==='unknown'?'Code (definition unknown)':'Code size';
}

export function latencyAverages(rows:LatencyRow[],engines:string[],mode:'shared'|'per-engine') {
 const cells=new Map<string,Map<string,LatencyRow>>();
 for(const row of selectEngineVersions(rows)) {
  if(!engines.includes(row.engine)||row.latencyStatus!=='ok'||row.latencyNs==null||!Number.isFinite(row.latencyNs)||row.latencyNs<=0)continue;
  const key=row.workload+'|'+(row.contractSha256||row.artifactSha256);
  if(!cells.has(key))cells.set(key,new Map());
  cells.get(key)!.set(row.engine,row);
 }
 return engines.map(engine=>{
  const values=[...cells.values()].filter(c=>mode==='per-engine'||engines.every(e=>c.has(e))).flatMap(c=>c.has(engine)?[c.get(engine)!.latencyNs!]:[]);
  return {engine,count:values.length,value:values.length?Math.exp(values.reduce((sum,v)=>sum+Math.log(v),0)/values.length):null};
 });
}
