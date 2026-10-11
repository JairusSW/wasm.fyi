import {expect,it} from 'vitest';
import {tableRange} from './table-window.svelte';
it('bounds mounted rows and preserves the full scroll height',()=>{
 const heights=Array.from({length:10000},(_,i)=>i%8===0?48:32);
 for(const offset of [0,500,100000,300000]){
  const r=tableRange(heights,offset,600);
  expect(r.end-r.start).toBeLessThan(30);
  expect(r.top+heights.slice(r.start,r.end).reduce((a,b)=>a+b,0)+r.bottom).toBe(heights.reduce((a,b)=>a+b,0));
 }
});
it('handles empty tables and reaches the final rows',()=>{
 expect(tableRange([],0,600)).toEqual({start:0,end:0,top:0,bottom:0});
 expect(tableRange([30,60,40],90,500,0)).toEqual({start:2,end:3,top:90,bottom:0});
});
