import {describe,it,expect} from 'vitest';
import {runtimeFilterRows} from './runtime-filter-data';
import type {ViewData} from './api/view-contract';
import type {Cfg} from './data/types';
const configs=[{id:'G',rt:'wago',be:'railshot'}] as Cfg[];
function fixture(){return {catalogue:[{id:'a'},{id:'b'},{id:'features/simd/a/performance-x'},{id:'features/simd/a/check'}],hosts:{m1:{configurations:{G:{version:'beta.13'}},snapshots:{s1:{'a|G|steady':{st:'ok',v:1},'b|G|steady':{st:'ok',v:9},'a|G|code':{st:'na'},'features/simd/a/performance-x|G|steady':{st:'ok',v:4},'features/simd/a/check|G|steady':{st:'ok',v:100}}}}},configurations:{G:'wago'},featureVersions:{m1:[{id:'wago',features:[{id:'simd',total:2,pass:2,contracts:[{status:'passed'},{status:'passed'}]}]}]}} as unknown as ViewData}
describe('runtime filter measurements',()=>{
 it('uses selected mean and only main workloads for main filtering',()=>{const view=fixture();expect(runtimeFilterRows(view,'m1',configs,false,'mean')[0].values).toMatchObject({steady:5,code:null,pass:100});expect(runtimeFilterRows(view,'m1',configs,false,'geo')[0].values.steady).toBeCloseTo(3)});
 it('uses feature perf probes and gates them on the full correctness suite',()=>{const view=fixture();expect(runtimeFilterRows(view,'m1',configs,true,'mean')[0].values).toMatchObject({steady:4,pass:100});view.featureVersions.m1[0].features[0].pass=1;expect(runtimeFilterRows(view,'m1',configs,true,'mean')[0].values).toMatchObject({steady:null,pass:50})});
 it('keeps failed workloads in the full pass-rate denominator',()=>{const view=fixture();view.hosts.m1.snapshots.s1['b|G|steady']={st:'failed',report:''};expect(runtimeFilterRows(view,'m1',configs,false,'mean')[0].values).toMatchObject({steady:1,pass:50})});
});
