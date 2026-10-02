import {describe,it,expect} from 'vitest';
import {featureContracts,compatCell,featureOutcome,type Scope} from './model';
import {featureValue} from './feature-values';
import {COMPAT} from './data/features';
import {viewData,viewCell} from './view-data';
const scope:Scope={machine:'m1',baseline:'A',hide:{},weighting:'corpus'};
describe('feature views retain distinct evidence scopes',()=>{
	 it('covers all 24 measured families while excluding scalar baselines',()=>{
   const families=COMPAT.flatMap(s=>s.fams);
	   expect(families).toHaveLength(24);
	   expect(families.reduce((sum,f)=>sum+featureContracts(f.id).length,0)).toBe(205);
   for(const f of families)for(const w of featureContracts(f.id))expect(w.baseline).toBe(false);
 });
 it('uses compilation for compile-only probes and invocation for bandwidth/allocation',()=>{
   const compile=featureContracts('cm-async')[0];
   expect(compile.evidenceScope).toBe('compile-only');
   expect(featureOutcome(scope,compile,'A')).toEqual(viewCell('m1','s1',compile.id,'A','compile'));
   for(const w of featureContracts('memory64').filter(w=>['allocation','memory-bandwidth'].includes(w.evidenceScope || '')))
     expect(featureOutcome(scope,w,'F')).toEqual(viewCell('m1','s1',w.id,'F','steady'));
 });
 it('retains unavailable adapter subsets without crediting baseline successes',()=>{
   const simd=compatCell('simd','D',scope);
   expect(simd.total).toBe(15);expect(simd.pass).toBe(0);expect(simd.skip).toBe(15);
   expect(featureValue(scope,'features/simd/i32x4-add-multiply/4096','D')).toBeNull();
 });
 it('worker evidence includes only verified 1/2/4/8-worker cases on both hosts',()=>{
   for(const host of Object.values(viewData.threads)){
     expect(host.results).toHaveLength(64);
      for(const mode of ['optimizing-only','liftoff-only'])expect(host.results.filter(r=>r.compilerMode===mode)).toHaveLength(32);
     expect([...new Set(host.results.map(r=>r.workers))].sort((a,b)=>a-b)).toEqual([1,2,4,8]);
     for(const r of host.results)for(const l of r.launches)for(const s of l.samples){expect(s.verified).toBe(true);expect(s.operations).toBe(r.workers*r.operationsPerWorker);}
   }
 });
});
