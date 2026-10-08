import {describe,it,expect,vi} from 'vitest';
import {DatasetClient} from './client';
const revision='a'.repeat(64);
const manifest={schema:2,revision,limits:{},endpoints:[],selectionAliases:{s1:'current',s2:'previous'}};
const response=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
describe('revision-scoped API client',()=>{
 it('hydrates a prepared page without discovery and pins additional reads to its revision',async()=>{
  const request=vi.fn(async(_url:unknown)=>response({revision,items:[],total:0,nextCursor:'',complete:true}));
  const client=DatasetClient.fromManifest({...manifest,schema:2},'',request as typeof fetch);
  expect(request).not.toHaveBeenCalled();
  await client.results({limit:25});expect(request).toHaveBeenCalledTimes(1);expect(String(request.mock.calls[0][0])).toContain(`revision=${revision}`);
  expect(()=>DatasetClient.fromManifest({...manifest,schema:2,revision:'bad'})).toThrow('Invalid embedded');
 });
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
 it('pins comparisons and history scopes without unsupported top-level revision parameters',async()=>{
  const request=vi.fn(async(url:unknown)=>{const parsed=new URL(String(url),'http://localhost');if(parsed.pathname.endsWith('/manifest'))return response(manifest);const scope=JSON.parse(parsed.searchParams.get('scope')!);return response({scope,cards:[]})});
  const client=await DatasetClient.connect('',request as typeof fetch);
  const scope={environment:'b'.repeat(64),lanes:['c'.repeat(64)]};
  await client.load('overview',{scope:JSON.stringify(scope),version:'wasmfyi-cohort-v4'});
  const url=new URL(String(request.mock.calls[1][0]),'http://localhost');expect(url.searchParams.has('revision')).toBe(false);expect(JSON.parse(url.searchParams.get('scope')!).revision).toBe(revision);expect(scope).not.toHaveProperty('revision');
  await expect(client.load('overview',{scope:JSON.stringify({...scope,revision:'d'.repeat(64)})})).rejects.toThrow('Query revision');
  await client.load('history/series',{scope:JSON.stringify(scope),version:'observed-minmax-v1'});
 });
 it('resolves a historical URL revision independently of the current publication',async()=>{
  const previous='d'.repeat(64);
  const request=vi.fn(async(url:unknown)=>response(String(url).endsWith('/manifest')?manifest:String(url).includes('/revisions/')?{id:previous,revision:{id:previous}}:{revision:previous,items:[]}));
  const client=await DatasetClient.connect('',request as typeof fetch,undefined,previous);
  expect(client.revision).toBe(previous);await client.results({});expect(String(request.mock.calls[2][0])).toContain(`revision=${previous}`);
 });
 it('retries rate limits and rejects malformed retry contracts',async()=>{
  let limited=true;
  const request=vi.fn(async(url:unknown)=>String(url).endsWith('/manifest')?response(manifest):limited?(limited=false,new Response('{}',{status:429,headers:{'Retry-After':'1'}})):response({revision,items:[]}));
  const client=await DatasetClient.connect('',request as typeof fetch);await client.load('features',{report:'b'.repeat(64)});expect(request).toHaveBeenCalledTimes(3);
  const invalid=vi.fn(async(url:unknown)=>String(url).endsWith('/manifest')?response(manifest):new Response('{}',{status:429,headers:{'Retry-After':'0'}}));
  const other=await DatasetClient.connect('',invalid as typeof fetch);await expect(other.results({})).rejects.toThrow('Invalid API retry delay');
 });
 it('loads selected descriptors and rejects arbitrary resource paths',async()=>{
  const request=vi.fn(async(url:unknown)=>response(String(url).endsWith('/manifest')?manifest:{revision,items:[]}));const client=await DatasetClient.connect('',request as typeof fetch);
  await client.load(`methods/${'b'.repeat(64)}`,{definition:'c'.repeat(64)});await client.load(`artifacts/${'b'.repeat(64)}/functions`,{limit:50});await client.load('conformance-contexts',{source:'d'.repeat(64)});
  await expect(client.load('reports/../../admin')).rejects.toThrow('Unsupported API resource');
 });

});
