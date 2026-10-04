import {describe,it,expect} from 'vitest';
import {featureContracts,compatCell,type Scope} from './model';
import {featureValue} from './feature-values';
import {COMPAT} from './data/features';
import {viewData} from './view-data';
const scope:Scope={machine:'m1',baseline:'G',hide:{},weighting:'corpus'};
describe('a collection without features',()=>{
 it('does not retain old feature families or contracts',()=>{
  expect(COMPAT.flatMap(s=>s.fams)).toHaveLength(0);
  expect(viewData.catalogue.some(w=>w.id.startsWith('features/'))).toBe(false);
  expect(featureContracts('simd')).toHaveLength(0);
 });
 it('does not credit erased feature timing values',()=>{
  for(const machine of ['m1','m2'] as const)expect(featureValue({...scope,machine},'features/simd/i32x4-add-multiply/4096','G')).toBeNull();
 });
 it('does not turn absent adapter coverage into success or failure',()=>{
  const result=compatCell('simd','G',scope);
  expect(result.total).toBe(0);expect(result.pass).toBe(0);expect(result.fail).toBe(0);expect(result.run).toBe(false);
 });
 it('does not retain erased worker measurements on either host',()=>{
  for(const host of Object.values(viewData.threads)){expect(host.results).toHaveLength(0);expect(host.evidence).toBe('');}
 });
});
