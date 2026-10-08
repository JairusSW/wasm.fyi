import {describe,it,expect} from 'vitest';
import {RequestPool} from './request-pool';
describe('revision-scoped request pool',()=>{
 it('shares a fetch while one consumer switches hosts',async()=>{
  const pool=new RequestPool();let calls=0,finish!:(value:number)=>void;
  const fetcher=(signal:AbortSignal)=>{calls++;return new Promise<number>((resolve,reject)=>{finish=resolve;signal.addEventListener('abort',()=>reject(signal.reason))})};
  const first=new AbortController();const a=pool.load('revision/host/metric',fetcher,first.signal);const b=pool.load('revision/host/metric',fetcher);
  await Promise.resolve();first.abort();await expect(a).rejects.toBeDefined();finish(42);expect(await b).toBe(42);expect(calls).toBe(1);
 });
 it('cancels an unused scope and lets a later request retry',async()=>{
  const pool=new RequestPool(),controller=new AbortController();let abandoned=false;
  const request=pool.load('old-host',signal=>new Promise<number>((_,reject)=>{signal.addEventListener('abort',()=>{abandoned=true;reject(signal.reason)})}),controller.signal);
  await Promise.resolve();controller.abort();await expect(request).rejects.toBeDefined();expect(abandoned).toBe(true);
  expect(await pool.load('old-host',async()=>7)).toBe(7);
 });
});
