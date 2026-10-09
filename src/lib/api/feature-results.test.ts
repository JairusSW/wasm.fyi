import {describe,it,expect} from 'vitest';
import {featureResults} from './feature-results';
import type {Result} from './benchmark-types';

const row=(workload:string,phase:Result['phase'],latencyStatus:Result['latencyStatus'])=>({workload,phase,latencyStatus,engine:'wago',capturedAt:'2026-10-08T00:00:00Z'} as Result);
describe('feature capture projection',()=>{
 it('counts each contract once and uses execution rather than compilation as its outcome',()=>{
  const [family]=featureResults([
   row('features/simd/add/performance','compile','ok'),
   row('features/simd/add/performance','steady','failed'),
   row('features/simd/mul/performance','steady','ok'),
   row('features/simd/div/performance','steady','unsupported')
  ]);
  expect([family.id,family.total,family.pass,family.failed,family.unsupported]).toEqual(['simd',3,1,1,1]);
 });
 it('retains compile-only and lifecycle probes without claiming they executed',()=>{
  const [family]=featureResults([
   row('features/gc/compile/1','compile','ok'),
   row('features/gc/lifecycle/1','instantiate','ok')
  ]);
  expect([family.pass,family.compiledOnly,family.executed]).toEqual([2,1,0]);
  expect(family.contracts.map(c=>c.scope)).toEqual(['compile-only','compile-and-instantiate']);
 });
});
