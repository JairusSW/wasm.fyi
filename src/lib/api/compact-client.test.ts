import {describe,it,expect} from 'vitest';
import {CompactClient} from './compact-client';

describe('compact request coordination',()=>{
 it('shares a fetch while one caller cancels',async()=>{
  let complete!:(response:Response)=>void;let calls=0;let shared:AbortSignal|undefined;
  const client=new CompactClient(((_url,options)=>{calls++;shared=options?.signal as AbortSignal;return new Promise(resolve=>complete=resolve)}) as typeof fetch);
  const first=new AbortController(),second=new AbortController();
  const a=client.load('/api/summary',first.signal).catch(error=>error);
  const b=client.load('/api/summary',second.signal);
  await Promise.resolve();first.abort();expect(shared?.aborted).toBe(false);
  complete(Response.json({revision:'one'}));expect(await b).toEqual({revision:'one'});await a;expect(calls).toBe(1);
  expect(await client.load('/api/summary',second.signal)).toEqual({revision:'one'});expect(calls).toBe(1);
 });
 it('limits concurrent HTTP requests to four',async()=>{
  let active=0,maximum=0;const waiting:(()=>void)[]=[];
  const client=new CompactClient((()=>{active++;maximum=Math.max(maximum,active);return new Promise(resolve=>waiting.push(()=>{active--;resolve(Response.json({ok:true}))}))}) as typeof fetch);
  const abort=new AbortController();const requests=Array.from({length:9},(_,i)=>client.load(`/api/overview?platform=${i}`,abort.signal));
  for(let i=0;i<20;i++)await Promise.resolve();expect(waiting.length).toBe(4);
  while(waiting.length){waiting.shift()!();for(let i=0;i<30;i++)await Promise.resolve()}
  await Promise.all(requests);expect(maximum).toBe(4);
 });
 it('uses an ETag to poll without redownloading unchanged data',async()=>{
  let calls=0;const headers:Headers[]=[];
  const client=new CompactClient(((_url,options)=>{calls++;headers.push(new Headers(options?.headers));return Promise.resolve(calls===1?Response.json({revision:'one'},{headers:{ETag:'"one"'}}):new Response(null,{status:304}))}) as typeof fetch);
  const signal=new AbortController().signal;
  expect(await client.load('/api/summary',signal)).toEqual({revision:'one'});
  expect(await client.load('/api/summary',signal,true)).toEqual({revision:'one'});
  expect(headers[1].get('If-None-Match')).toBe('"one"');
 });
});
it('uses public shell metadata once and then revalidates normally',async()=>{
 const {vi}=await import('vitest');const node={textContent:JSON.stringify({revision:'inline',platforms:[]}),remove:vi.fn()};
 vi.stubGlobal('document',{getElementById:()=>node});
 try{
  const fetch=vi.fn(async()=>Response.json({revision:'fresh',platforms:[]}));
  const client=new CompactClient(fetch);const signal=new AbortController().signal;
  expect(await client.load('/api/summary',signal,true)).toEqual({revision:'inline',platforms:[]});expect(fetch).not.toHaveBeenCalled();
  expect(await client.load('/api/summary',signal,true)).toEqual({revision:'fresh',platforms:[]});expect(fetch).toHaveBeenCalledOnce();expect(node.remove).toHaveBeenCalledOnce();
 }finally{vi.unstubAllGlobals()}
});
it('falls back to the API if shell metadata is invalid',async()=>{
 const {vi}=await import('vitest');vi.stubGlobal('document',{getElementById:()=>({textContent:'not json',remove:vi.fn()})});
 try{const fetch=vi.fn(async()=>Response.json({revision:'fresh'}));const client=new CompactClient(fetch);expect(await client.load('/api/summary',new AbortController().signal)).toEqual({revision:'fresh'});expect(fetch).toHaveBeenCalledOnce()}finally{vi.unstubAllGlobals()}
});
