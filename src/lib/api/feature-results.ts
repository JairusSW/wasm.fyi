import type {Result} from './benchmark-types';
export function featureResults(measurements:Result[]){
 measurements=measurements.filter(r=>!r.display?.tags?.includes('baseline'));
 const families=new Map<string,Map<string,Result[]>>();
 for(const row of measurements){
  const id=row.workload.split('/')[1];
  let workloads=families.get(id);if(!workloads){workloads=new Map();families.set(id,workloads)}
  let candidates=workloads.get(row.workload);if(!candidates){candidates=[];workloads.set(row.workload,candidates)}
  candidates.push(row);
 }
 return [...families].map(([id,group])=>{
     const workloads=[...group.keys()];
     const contracts=workloads.map(workload=>{
      const candidates=group.get(workload)!;
      const row=candidates.find(r=>r.phase==='steady')||candidates.find(r=>r.phase==='first-call')||candidates.find(r=>r.phase==='instantiate')||candidates[0];
      const result: 'passed'|'failed'|'unsupported'=candidates.some(r=>r.latencyStatus==='failed')?'failed':row.latencyStatus==='ok'?'passed':'unsupported';
      return {workload,status:result,scope:row.phase==='compile'?'compile-only':row.phase==='instantiate'?'compile-and-instantiate':'execution',report:row.capturedAt+'|'+row.engine,reasons:[] as string[]};
     });
     return {id,total:contracts.length,pass:contracts.filter(c=>c.status==='passed').length,failed:contracts.filter(c=>c.status==='failed').length,unsupported:contracts.filter(c=>c.status==='unsupported').length,compiledOnly:contracts.filter(c=>c.scope==='compile-only').length,executed:contracts.filter(c=>c.scope==='execution'&&c.status==='passed').length,reports:contracts.map(c=>c.report),reasons:[],contracts};
    });
}
