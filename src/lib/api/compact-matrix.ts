import type {Result,Source,Sampling,Display} from './benchmark-types';
export type SampleStats={count:number;mean:number;stdDev:number|null;min:number;max:number};
export type ScalarResult=Result&{observationId:number;platformId?:string;sampleStats?:SampleStats;latencySummary?:'retained-mean'};
export type CompactMatrix={schema:1|2;revision:string;platform:string;phase:Result['phase'];total:number;nextOffset:number|null;contracts:{workload:string;wasm:string;artifactSha256:string;contractSha256:string;display?:Display}[];configurations:{engine:string;version:string;backend:string}[];sources:(Source|null)[];sampling:(Sampling|null)[];capturedAt:string[];rows:unknown[][]};
export function unpackMatrix(page:CompactMatrix):ScalarResult[]{
 if(![1,2].includes(page.schema)||!Array.isArray(page.rows))throw Error('Unsupported matrix format');
 return page.rows.map(row=>{
  if(row.length!==(page.schema===2?15:14))throw Error('Invalid matrix row');
  const [observationId,contract,cfg,source,captured,latencyNs,peakRssBytes,codeBytes,latencyStatus,memoryStatus,codeStatus,codeKind,timingSamples,policy]=row as [number,number,number,number,number,number|null,number|null,number|null,Result['latencyStatus'],Result['memoryStatus'],Result['codeStatus'],Result['codeKind'],number,number];
  if(!page.contracts[contract]||!page.configurations[cfg]||page.capturedAt[captured]===undefined||!(source in page.sources)||!(policy in page.sampling))throw Error('Invalid matrix dictionary index');
  let sampleStats:SampleStats|undefined;
  if(page.schema===2&&row[14]!=null){const values=row[14] as [number,number,number|null,number,number];if(!Array.isArray(values)||values.length!==5)throw Error('Invalid sample statistics');sampleStats={count:values[0],mean:values[1],stdDev:values[2],min:values[3],max:values[4]}}
  const recovered=latencyStatus==='ok'&&(latencyNs==null||latencyNs===0)&&!!sampleStats&&sampleStats.mean>0;
  return {...(recovered?{latencySummary:'retained-mean' as const}:{}),...(sampleStats?{sampleStats}:{}),...page.contracts[contract],...page.configurations[cfg],observationId,platformId:page.platform,phase:page.phase,capturedAt:page.capturedAt[captured],latencyNs:latencyStatus==='ok'&&(latencyNs==null||latencyNs===0)&&sampleStats&&sampleStats.mean>0?sampleStats.mean:latencyNs,peakRssBytes,codeBytes,latencyStatus,memoryStatus,codeStatus,codeKind,timingSamples,...(page.sources[source]?{source:page.sources[source]!}:{}),...(page.sampling[policy]?{sampling:page.sampling[policy]!}:{})};
 });
}

export type CompactAggregate={revision:string;platform:string;metric:string;workloads?:string[];participants:string[];cards:{engine:string;version:string;backend:string;source?:Source;value:number|null;ratio:number|null;count:number;latestCreated?:string;unavailableReason?:string}[]};
