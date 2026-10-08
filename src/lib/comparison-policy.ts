/** Website selection and weighting policy, independent of storage and evidence loading. */
export interface ComparableCell { st:string; v?:number; report:string }
export function measuredCohort<T extends {id:string}, C extends string>(workloads:T[], selected:C[], cid:C, cell:(w:string,c:C)=>ComparableCell, requireAll=false) {
	const available=(w:string,c:C)=>{const v=cell(w,c);return !!v.report && v.st==='ok' && v.v!=null && Number.isFinite(v.v) && v.v>0;};
	const participants=selected.filter(c=>workloads.some(w=>available(w.id,c)));
	return {participants,cohort:participants.includes(cid)?workloads.filter(w=>(requireAll?selected:participants).every(c=>available(w.id,c))):[]};
}
export function cohortWeights(workloads:{group:string}[], weighting:'workload'|'corpus'):number[] {
	const counts=new Map<string,number>();for(const w of workloads)counts.set(w.group,(counts.get(w.group)||0)+1);
	return workloads.map(w=>weighting==='workload'?1/workloads.length:1/(counts.size*counts.get(w.group)!));
}
export const weightedGeometricMean=(values:number[],weights:number[])=>Math.exp(values.reduce((sum,v,i)=>sum+weights[i]*Math.log(v),0));

/** An explicit n/a does not participate in the native-code comparison. */
export function nativeCodeParticipants<T extends {id:string}, C extends string>(workloads:T[], selected:C[], cell:(w:string,c:C)=>ComparableCell):C[] {
 return selected.filter(c=>{
  const statuses=workloads.map(w=>cell(w.id,c).st);
  return !(statuses.includes('unsupported')&&statuses.every(st=>['unsupported','nm','na'].includes(st)));
 });
}
