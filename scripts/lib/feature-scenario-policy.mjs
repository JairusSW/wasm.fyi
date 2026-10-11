export function featureScenarios(kind,workload,repairPhases=[]){
 if(repairPhases.length)return repairPhases.join(',');
 if(kind==='compatibility')return 'first-call';
 if(kind==='compile')return workload.provenance?.scope==='compile-and-instantiate'?'compile,instantiate':'compile';
 return 'compile,instantiate,first-call,steady';
}
