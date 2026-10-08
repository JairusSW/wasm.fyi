import {expect,it} from 'vitest';
import {nativeCodeParticipants,measuredCohort} from './comparison-policy';
it('keeps a shared native-code comparison when another engine reports n/a',()=>{
 const workloads=[{id:'tiny'},{id:'other'}];
 const cell=(workload:string,engine:string)=>engine==='interpreter'?{st:workload==='tiny'?'unsupported':'nm',report:'r'}:{st:'ok',v:engine==='jit'?100:200,report:'r'};
 const selected=nativeCodeParticipants(workloads,['jit','aot','interpreter'],cell);
 expect(selected).toEqual(['jit','aot']);
 expect(measuredCohort(workloads,selected,'jit',cell,true).cohort).toHaveLength(2);
});
it('keeps failed and entirely unmeasured engines in the strict comparison',()=>{
 const workloads=[{id:'tiny'}];const cell=(_workload:string,engine:string)=>({st:engine==='failed'?'failed':'nm',report:'r'});
 expect(nativeCodeParticipants(workloads,['failed','unmeasured'],cell)).toEqual(['failed','unmeasured']);
});
