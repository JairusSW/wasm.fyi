import {expect,it} from 'vitest';
import {leastCoveredReference} from './comparison-policy';
it('uses the smallest passing set instead of intersecting non-nested engine results',()=>{
 const passes:Record<'a'|'b'|'empty',number[]>={a:[1,2],b:[1,3,4],empty:[]};
 expect(leastCoveredReference([1,2,3,4],['a','b','empty'] as const,(w,c)=>passes[c].includes(w))).toEqual([1,2]);
});
it('reselects the reference when an engine is hidden and handles no measurements',()=>{
 expect(leastCoveredReference([1,2,3],['b'],()=>true)).toEqual([1,2,3]);
 expect(leastCoveredReference([1],['empty'],()=>false)).toEqual([]);
});
