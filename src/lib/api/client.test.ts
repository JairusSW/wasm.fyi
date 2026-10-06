import {describe,it,expect,vi} from 'vitest';
import {DatasetClient} from './client';
const revision='a'.repeat(64);
const manifest={schema:2,revision,limits:{},endpoints:[],selectionAliases:{s1:'current',s2:'previous'}};
const response=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
describe('revision-scoped API client',()=>{
 it('connects with one small manifest, requests only selected resources and caches by normalized query',async()=>{
  const request=vi.fn(async(url:unknown)=>response(String(url).endsWith('/manifest')?manifest:{revision,items:[],total:0,nextCursor:'',complete:true}));
  const client=await DatasetClient.connect('',request as typeof fetch);expect(request).toHaveBeenCalledTimes(1);
  await client.results({limit:100,environment:'selected'});await client.results({environment:'selected',limit:100});expect(request).toHaveBeenCalledTimes(2);
  expect(String(request.mock.calls[1][0])).toContain('environment=selected');expect(String(request.mock.calls[1][0])).toContain(`revision=${revision}`);expect(request.mock.calls.some(c=>String(c[0]).includes('/reports'))).toBe(false);
 });
 it('rejects stale responses, oversized decoded JSON, and mixed revisions',async()=>{
  const stale=vi.fn(async(url:unknown)=>response(String(url).endsWith('/manifest')?manifest:{revision:'b'.repeat(64)}));const client=await DatasetClient.connect('',stale as typeof fetch);
  await expect(client.results({})).rejects.toThrow('Response revision');await expect(client.results({revision:'b'.repeat(64)})).rejects.toThrow('Query revision');
  const huge=vi.fn(async(url:unknown)=>String(url).endsWith('/manifest')?response(manifest):new Response(' '.repeat(1024*1024+1)));const limited=await DatasetClient.connect('',huge as typeof fetch);await expect(limited.results({})).rejects.toThrow('decoded-byte');
 });
 it('aborts obsolete requests when a revision client closes',async()=>{
  let pendingSignal:AbortSignal|undefined;const request=vi.fn(async(url:unknown,options?:RequestInit)=>{if(String(url).endsWith('/manifest'))return response(manifest);pendingSignal=options?.signal as AbortSignal;return response({revision,items:[]})});const client=await DatasetClient.connect('',request as typeof fetch);const promise=client.results({});client.close();expect(pendingSignal?.aborted).toBe(true);await expect(promise).rejects.toThrow();
 });
 it('loads report evidence only when explicitly requested',async()=>{
  const request=vi.fn(async(url:unknown)=>response(String(url).endsWith('/manifest')?manifest:{kind:'pass-context',manifest:{id:'pass'}}));
  const client=await DatasetClient.connect('',request as typeof fetch);
  expect(request).toHaveBeenCalledTimes(1);
  const value=await client.load<{kind:string}>(`reports/${'b'.repeat(64)}/evidence`,{chunk:'c'.repeat(64)});
  expect(value.kind).toBe('pass-context');expect(request).toHaveBeenCalledTimes(2);
  expect(String(request.mock.calls[1][0])).toContain(`revision=${revision}`);
 });

});
