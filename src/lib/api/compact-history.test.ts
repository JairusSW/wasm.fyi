import {describe,it,expect} from 'vitest';
import {historyFactor,scaledChange,type HistoricalChange} from './compact-history';
import {CompactClient} from './compact-client';

describe('compact historical comparisons',()=>{
 const change:HistoricalChange={engine:'runtime',fromDate:'2026-09-06',toDate:'2026-09-13',before:1e6,after:2e6,ratio:2,count:7,reference:9,reused:false};
 it('preserves matched-cohort ratios and counts while converting display units',()=>{
  expect(scaledChange(change,'exec')).toEqual({before:1,after:2,ratio:2,count:7,reused:false});
  expect(scaledChange({...change,before:1024,after:2048},'code')?.after).toBe(2);
  expect(historyFactor('mem')).toBe(1024**2);
  expect(historyFactor('cov')).toBe(1);
 });
 it('keeps missing comparisons unavailable rather than inventing a delta',()=>{
  expect(scaledChange({...change,before:null},'exec')).toBeNull();
  expect(scaledChange({...change,ratio:null},'exec')).toBeNull();
 });
 it('coalesces history requests and reuses completed summaries without another fetch',async()=>{
  let calls=0;
  const client=new CompactClient(async()=>{calls++;return new Response(JSON.stringify({revision:'fixture',items:[]}),{headers:{ETag:'fixture'}})});
  const path='/api/history/summary?platform=fixture&metric=exec';
  const abort=new AbortController();
  const [a,b]=await Promise.all([client.load(path,abort.signal),client.load(path,abort.signal)]);
  expect(a).toEqual(b);expect(calls).toBe(1);
  await client.load(path,abort.signal);expect(calls).toBe(1);
  client.close();
 });
});
