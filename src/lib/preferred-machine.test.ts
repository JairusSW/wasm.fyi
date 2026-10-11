import {describe,it,expect} from 'vitest';
import {preferredMachine} from './preferred-machine';

describe('visitor machine default',()=>{
 it('uses the reported CPU architecture before platform hints',async()=>{
  expect(await preferredMachine({userAgent:'Macintosh',userAgentData:{getHighEntropyValues:async()=>({architecture:'x86'})}})).toBe('m1');
  expect(await preferredMachine({userAgent:'Windows',userAgentData:{getHighEntropyValues:async()=>({architecture:'arm'})}})).toBe('m2');
 });
 it('defaults Apple platforms to Apple and other desktop platforms to Hub',async()=>{
  expect(await preferredMachine({userAgent:'Mozilla Macintosh Intel Mac OS X',platform:'MacIntel'})).toBe('m2');
  expect(await preferredMachine({userAgent:'Linux x86_64'})).toBe('m1');
  expect(await preferredMachine({userAgent:'Linux aarch64'})).toBe('m2');
 });
 it('recovers from withheld or stalled client hints',async()=>{
  expect(await preferredMachine({userAgent:'Macintosh',userAgentData:{getHighEntropyValues:async()=>{throw Error('denied')}}})).toBe('m2');
  expect(await preferredMachine({userAgent:'Windows',userAgentData:{getHighEntropyValues:()=>new Promise(()=>{})}},1)).toBe('m1');
 });
});
