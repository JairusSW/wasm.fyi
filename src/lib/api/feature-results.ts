import type {Result} from './benchmark-types';
export function featureResults(measurements:Result[]){
 return [...new Set(measurements.map(r=>r.workload.split('/')[1]))].map(id=>{
     const workloads=[...new Set(measurements.filter(r=>r.workload.split('/')[1]===id).map(r=>r.workload))];
     const contracts=workloads.map(workload=>{
      const candidates=measurements.filter(r=>r.workload===workload);
      const row=candidates.find(r=>r.phase==='steady')||candidates.find(r=>r.phase==='first-call')||candidates.find(r=>r.phase==='instantiate')||candidates[0];
      const result: 'passed'|'failed'|'unsupported'=row.latencyStatus==='ok'?'passed':row.latencyStatus==='failed'?'failed':'unsupported';
      return {workload,status:result,scope:row.phase==='compile'?'compile-only':row.phase==='instantiate'?'compile-and-instantiate':'execution',report:row.capturedAt+'|'+row.engine,reasons:[] as string[]};
     });
     return {id,total:contracts.length,pass:contracts.filter(c=>c.status==='passed').length,failed:contracts.filter(c=>c.status==='failed').length,unsupported:contracts.filter(c=>c.status==='unsupported').length,compiledOnly:contracts.filter(c=>c.scope==='compile-only').length,executed:contracts.filter(c=>c.scope==='execution'&&c.status==='passed').length,reports:contracts.map(c=>c.report),reasons:[],contracts};
    });
}
