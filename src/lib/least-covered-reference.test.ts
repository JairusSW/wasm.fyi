import {expect,it} from 'vitest';
import {leastCoveredReference} from './comparison-policy';
it('filters non-nested passing sets to workloads passed by all measured engines',()=>{
 const passes:Record<'a'|'b'|'empty',number[]>={a:[1,2],b:[1,3,4],empty:[]};
 expect(leastCoveredReference([1,2,3,4],['a','b','empty'] as const,(w,c)=>passes[c].includes(w))).toEqual([1]);
});
it('reselects the reference when an engine is hidden and handles no measurements',()=>{
 expect(leastCoveredReference([1,2,3],['b'],()=>true)).toEqual([1,2,3]);
 expect(leastCoveredReference([1],['empty'],()=>false)).toEqual([]);
});

it('keeps all four Go runtimes comparable when unsupported workloads differ',()=>{
 const workloads=Array.from({length:145},(_,i)=>i),engines=['wago','wazero','wasm2go','wazy'];
 const result=leastCoveredReference(workloads,engines,(w,c)=>c==='wasm2go'?w>=2:c==='wazy'?w!==2:true);
 expect(result).toEqual(workloads.slice(3));
});
