// Independent process medians are the observations; samples within a process
// are never treated as independent replicates for stopping.
export const defaultAdaptiveSampling = Object.freeze({minLaunches:3,maxLaunches:10,relativeHalfWidth:0.03,confidence:0.95});
export function adaptivePolicy(value) {
 if(!value)return null;
 const p={...defaultAdaptiveSampling,...value};
 if(!Number.isInteger(p.minLaunches)||!Number.isInteger(p.maxLaunches)||p.minLaunches<3||p.maxLaunches<p.minLaunches||p.maxLaunches>100||!(p.relativeHalfWidth>0&&p.relativeHalfWidth<1)||!(p.confidence>0&&p.confidence<1))throw Error('Invalid adaptive sampling policy');
 return p;
}
export const median=values=>{const s=[...values].sort((a,b)=>a-b),i=s.length>>1;return s.length%2?s[i]:(s[i-1]+s[i])/2;};
// Student t CDF via the exact cosine-integral recurrence for integer degrees
// of freedom. Bonferroni spends alpha across all possible stopping looks.
function cosineIntegral(power,angle) {
 if(power===0)return angle;
 if(power===1)return Math.sin(angle);
 return Math.sin(angle)*Math.cos(angle)**(power-1)/power+(power-1)/power*cosineIntegral(power-2,angle);
}
export function studentCritical(df,tail) {
 const denominator=cosineIntegral(df-1,Math.PI/2);
 const survival=x=>0.5*(1-cosineIntegral(df-1,Math.atan(x/Math.sqrt(df)))/denominator);
 let lo=0,hi=1;while(survival(hi)>tail)hi*=2;
 for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(survival(mid)>tail)lo=mid;else hi=mid;}
 return (lo+hi)/2;
}
export function samplingPrecision(medians,policy) {
 const n=medians.length,mean=medians.reduce((a,b)=>a+b,0)/n;
 if(n<policy.minLaunches)return {launches:n,metTarget:false};
 const variance=medians.reduce((a,b)=>a+(b-mean)**2,0)/(n-1);
 const tail=(1-policy.confidence)/(2*(policy.maxLaunches-policy.minLaunches+1));
 const halfWidth=studentCritical(n-1,tail)*Math.sqrt(variance/n);
 return {launches:n,meanLaunchMedianNs:mean,halfWidthNs:halfWidth,relativeHalfWidth:mean>0?halfWidth/mean:null,metTarget:mean>0&&halfWidth/mean<=policy.relativeHalfWidth};
}
export function launchMedian(trials,engine,workload,phase,samples) {
 const related=trials.filter(t=>t.runtime_configuration===engine&&t.workload===workload);
 if(related.some(t=>!['ok','unsupported','disabled'].includes(t.status)))return {terminal:true,reason:'failed'};
 const measured=related.filter(t=>t.profile==='timing'&&t.scenario===phase&&t.block>=0);
 if(measured.some(t=>['unsupported','disabled'].includes(t.status)))return {terminal:true,reason:measured.find(t=>['unsupported','disabled'].includes(t.status)).status};
 const values=measured.flatMap(t=>t.samples||[]).filter(s=>!s.warmup&&s.verified&&Number.isSafeInteger(s.operations)&&s.operations>0&&Number.isSafeInteger(s.elapsed_ns)&&s.elapsed_ns>=0).map(s=>s.elapsed_ns/s.operations);
 if(values.length!==samples)throw Error(`Adaptive launch requires ${samples} verified samples for ${engine}/${workload}/${phase}; got ${values.length}`);
 return {value:median(values)};
}
