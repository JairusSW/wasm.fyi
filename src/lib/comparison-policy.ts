/** Website selection and weighting policy, independent of storage and evidence loading. */
export interface ComparableCell { st:string; v?:number; report:string }
export function measuredCohort<T extends {id:string}, C extends string>(workloads:T[], selected:C[], cid:C, cell:(w:string,c:C)=>ComparableCell, requireAll=false, identity:(engine:C)=>string=String) {
	const available=(w:string,c:C)=>{const v=cell(w,c);return !!v.report && v.st==='ok' && v.v!=null && Number.isFinite(v.v) && v.v>0;};
	const participants=selected.filter(c=>workloads.some(w=>available(w.id,c)));
	return {participants,cohort:participants.includes(cid)?requireAll?workloads.filter(w=>selected.every(c=>available(w.id,c))):leastCoveredReference(workloads,participants,(w,c)=>available(w.id,c),identity):[]};
}
export function cohortWeights(workloads:{group:string}[], weighting:'workload'|'corpus'):number[] {
	const counts=new Map<string,number>();for(const w of workloads)counts.set(w.group,(counts.get(w.group)||0)+1);
	return workloads.map(w=>weighting==='workload'?1/workloads.length:1/(counts.size*counts.get(w.group)!));
}
/** Weights sum to 1, so this is the plain mean under the chosen weighting. */
export const weightedArithmeticMean=(values:number[],weights:number[])=>values.reduce((sum,v,i)=>sum+weights[i]*v,0);
/** The scope's choice of average. */
export const weightedAverage=(kind:'geo'|'mean'|undefined)=>kind==='mean'?weightedArithmeticMean:weightedGeometricMean;
export const weightedGeometricMean=(values:number[],weights:number[])=>Math.exp(values.reduce((sum,v,i)=>sum+weights[i]*Math.log(v),0));

/** An explicit n/a does not participate in the native-code comparison. */
export function nativeCodeParticipants<T extends {id:string}, C extends string>(workloads:T[], selected:C[], cell:(w:string,c:C)=>ComparableCell):C[] {
 return selected.filter(c=>{
  const statuses=workloads.map(w=>cell(w.id,c).st);
  return !(statuses.includes('unsupported')&&statuses.every(st=>['unsupported','nm','na'].includes(st)));
 });
}

/** The least-covered measured engine supplies the reference, rather than an intersection. */
export function leastCoveredReference<T,C>(workloads:readonly T[],engines:readonly C[],passed:(workload:T,engine:C)=>boolean,identity:(engine:C)=>string=String):T[] {
 let reference:T[]=[];
 for(const engine of [...engines].sort((a,b)=>identity(a).localeCompare(identity(b)))){
  const rows=workloads.filter(workload=>passed(workload,engine));
  if(rows.length&&(!reference.length||rows.length<reference.length))reference=rows;
 }
 return reference;
}
