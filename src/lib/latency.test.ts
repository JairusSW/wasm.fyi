import {describe,it,expect} from 'vitest';
import {latencyAverages,engineVersionKey,selectEngineVersions,codeSizeLabel,type LatencyRow} from './latency';
const row=(workload:string,engine:string,latencyNs:number|null,contract='contract'):LatencyRow=>({workload,engine,wasm:'test.wasm',artifactSha256:'artifact',contractSha256:contract,version:'1',backend:'compiler',phase:'steady',capturedAt:'2026-10-08T00:00:00Z',codeKind:null,memoryStatus:'not-measured',codeStatus:'not-measured',peakRssBytes:null,codeBytes:null,latencyStatus:latencyNs==null?'failed':'ok',latencyNs});
describe('latency-only corpus averages',()=>{
 it('selects per-engine successes or the exact common passed population',()=>{
  const rows=[row('shared','a',1),row('shared','b',9),row('a-only','a',9),row('a-only','b',null)];
  const independent=latencyAverages(rows,['a','b'],'per-engine')[0];expect(independent.count).toBe(2);expect(independent.value).toBeCloseTo(3);
  const shared=latencyAverages(rows,['a','b'],'shared');expect(shared.map(a=>a.count)).toEqual([1,1]);expect(shared[0].value).toBe(1);expect(shared[1].value).toBeCloseTo(9);
 });
 it('does not compare changed inputs or ignore a requested engine with no passes',()=>{
  expect(latencyAverages([row('shared','a',1,'old'),row('shared','b',9,'new')],['a','b'],'shared').every(a=>a.value==null)).toBe(true);
  expect(latencyAverages([row('shared','a',1)],['a','b'],'shared').every(a=>a.count===0)).toBe(true);
 });
});

it('defaults to the latest measured version without averaging older workloads into it',()=>{
 const old={...row('old-only','a',100),version:'1',capturedAt:'2026-10-08T00:00:00Z'};
 const latest={...row('new-only','a',1),version:'2',capturedAt:'2026-10-08T01:00:00Z'};
 const rows=[old,latest];expect(latencyAverages(rows,['a'],'per-engine')).toEqual([{engine:'a',count:1,value:1}]);
 expect(selectEngineVersions(rows,{a:engineVersionKey(old)})).toEqual([old]);
 expect(selectEngineVersions(rows,{a:'removed-version'})).toEqual([latest]);
});
it('separates backends and applies shared eligibility to the chosen versions',()=>{
 const old={...row('shared','a',100),backend:'interpreter'};
 const latest={...row('shared','a',4),backend:'compiler',capturedAt:'2026-10-08T01:00:00Z'};
 const other=row('shared','b',9);
 const averages=latencyAverages([old,latest,other],['a','b'],'shared');expect(averages.map(a=>a.count)).toEqual([1,1]);expect(averages[0].value).toBeCloseTo(4);
});
it('labels code-size definitions without treating an unknown definition as a native image',()=>{
 expect(codeSizeLabel('native-image')).toBe('Native image');expect(codeSizeLabel('engine-reported')).toBe('Engine-reported code');expect(codeSizeLabel('unknown')).toContain('unknown');
});
it('selects the latest capture even when versions were measured within the same millisecond',()=>{
 const older={...row('old','a',100),version:'1',capturedAt:'2026-10-08T00:00:00.123000001Z'};
 const newer={...row('new','a',1),version:'2',capturedAt:'2026-10-08T00:00:00.123000009Z'};
 expect(selectEngineVersions([older,newer])).toEqual([newer]);
});
it('keeps the newest source selected while historical versions are captured backwards',()=>{
 const latest={...row('new','a',1),version:'2',source:{repository:'example/engine',revision:'new',ref:'main',kind:'snapshot' as const,asOf:'2026-10-07T00:00:00Z'}};
 const historical={...row('old','a',100),version:'1',capturedAt:'2026-10-08T02:00:00Z',source:{...latest.source,revision:'old',asOf:'2026-05-01T00:00:00Z'}};
 expect(selectEngineVersions([historical,latest])).toEqual([latest]);
});
it('shows one source snapshot and leaves holes instead of mixing same-version history',()=>{
 const latest={...row('new','a',1),source:{repository:'example/engine',revision:'b'.repeat(40),ref:'main',kind:'snapshot' as const,asOf:'2026-10-07T00:00:00Z'}};
 const older={...row('old-only','a',100),source:{...latest.source,revision:'a'.repeat(40),asOf:'2026-09-01T00:00:00Z'}};
 expect(selectEngineVersions([older,latest])).toEqual([latest]);
});
it('uses a qualified source snapshot ahead of an installed build with unknown source age',()=>{
 const installed={...row('old','a',100),version:'46',source:{repository:'example/engine',revision:'46',ref:'46',kind:'current' as const,asOf:'2026-10-08T00:00:00Z'}};
 const latest={...row('new','a',1),version:'49',source:{repository:'example/engine',revision:'b'.repeat(40),ref:'main',kind:'snapshot' as const,asOf:'2026-10-07T00:00:00Z'}};
 expect(selectEngineVersions([installed,latest])).toEqual([latest]);
});
