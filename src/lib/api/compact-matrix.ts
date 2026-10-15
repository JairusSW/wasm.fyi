import {computationCheckpoint} from '../computation';
import type {Result,Source,Sampling,Display} from './benchmark-types';
export type SampleStats={count:number;mean:number;stdDev:number|null;min:number;max:number};
export type ScalarResult=Result&{observationId:number;platformId?:string;sampleStats?:SampleStats;latencySummary?:'retained-mean'};
export type CompactMatrix={schema:1|2|3|4;dataRevision?:string;revision:string;platform:string;phase:Result['phase']|'*';total:number;nextOffset:number|null;contracts:{workload:string;wasm:string;artifactSha256:string;contractSha256:string;display?:Display}[];configurations:{engine:string;version:string;backend:string}[];sources:(Source|null)[];sampling:(Sampling|null)[];codeKinds?:Result['codeKind'][];capturedAt:string[];rows:unknown[][]};
export function unpackMatrix(page:CompactMatrix):ScalarResult[]{
 if(![1,2,3,4].includes(page.schema)||!Array.isArray(page.rows))throw Error('Unsupported matrix format');
 return page.rows.map(input=>{
  let row=input,recoveredMean:number|null=null;
  if(page.schema===4){
   if(row.length!==13)throw Error('Invalid table row');
   const flags=row[9] as number,kind=row[10] as number,phase=row[5] as number;
   const statuses=['not-measured','ok','failed','unsupported','disabled','unavailable'];
   if(!Number.isInteger(flags)||flags<0||flags>511||!Number.isInteger(phase)||phase<0||phase>3||!Number.isInteger(kind)||!page.codeKinds||!(kind in page.codeKinds))throw Error('Invalid table codes');
   const decoded=[flags&7,(flags>>3)&7,(flags>>6)&7].map(v=>statuses[v]);if(decoded.some(v=>v===undefined))throw Error('Invalid table status');
   recoveredMean=row[12] as number|null;
   if(recoveredMean!=null&&(!Number.isFinite(recoveredMean)||recoveredMean<=0))throw Error('Invalid recovered mean');
   row=[row[0],row[1],row[2],row[3],row[4],row[6],row[7],row[8],...decoded,page.codeKinds[kind],row[11],0,null,['compile','instantiate','first-call','steady'][phase]];
  }
  if(row.length!==(page.schema>=3?16:page.schema===2?15:14))throw Error('Invalid matrix row');
  if(page.schema>=3&&!['compile','instantiate','first-call','steady'].includes(String(row[15])))throw Error('Invalid table phase');
  const [observationId,contract,cfg,source,captured,latencyNs,peakRssBytes,codeBytes,latencyStatus,memoryStatus,codeStatus,codeKind,timingSamples,policy]=row as [number,number,number,number,number,number|null,number|null,number|null,Result['latencyStatus'],Result['memoryStatus'],Result['codeStatus'],Result['codeKind'],number,number];
  if(!page.contracts[contract]||!page.configurations[cfg]||page.capturedAt[captured]===undefined||!(source in page.sources)||!(policy in page.sampling))throw Error('Invalid matrix dictionary index');
  let sampleStats:SampleStats|undefined;
  if(page.schema>=2&&page.schema<=3&&row[14]!=null){const values=row[14] as [number,number,number|null,number,number];if(!Array.isArray(values)||values.length!==5)throw Error('Invalid sample statistics');sampleStats={count:values[0],mean:values[1],stdDev:values[2],min:values[3],max:values[4]}}
  const mean=recoveredMean??sampleStats?.mean;
  const recovered=latencyStatus==='ok'&&(latencyNs==null||latencyNs===0)&&mean!=null&&mean>0;
  return {...(recovered?{latencySummary:'retained-mean' as const}:{}),...(sampleStats?{sampleStats}:{}),...page.contracts[contract],...page.configurations[cfg],observationId,platformId:page.platform,phase:page.schema>=3?row[15] as Result['phase']:page.phase as Result['phase'],capturedAt:page.capturedAt[captured],latencyNs:recovered?mean!:latencyNs,peakRssBytes,codeBytes,latencyStatus,memoryStatus,codeStatus,codeKind,timingSamples,...(page.sources[source]?{source:page.sources[source]!}:{}),...(page.sampling[policy]?{sampling:page.sampling[policy]!}:{})};
 });
}

/** Decode bounded batches so large tables cannot monopolize the UI thread. */
export async function unpackMatrixAsync(page:CompactMatrix,signal:AbortSignal):Promise<ScalarResult[]> {
 const all:ScalarResult[]=[],checkpoint=computationCheckpoint(signal);
 for(let offset=0;offset<page.rows.length;offset+=128){
  all.push(...unpackMatrix({...page,rows:page.rows.slice(offset,offset+128)}));
  for(let i=0;i<128;i++){const pause=checkpoint();if(pause)await pause;}
 }
 signal.throwIfAborted();return all;
}

export type CompactAggregate={average?:'geo'|'mean';revision:string;platform:string;metric:string;workloads?:string[];participants:string[];cards:{engine:string;version:string;backend:string;source?:Source;value:number|null;ratio:number|null;count:number;latestCreated?:string;unavailableReason?:string}[]};
