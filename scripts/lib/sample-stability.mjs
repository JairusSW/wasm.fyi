// Same-process observations establish repeatability, not independent-launch
// confidence intervals. Retain acquisition order and every raw observation.
export const samplePolicy=Object.freeze({groupSize:5,maxSamples:25,phaseSampleCaps:Object.freeze({compile:10,instantiate:10,'first-call':25,steady:25}),warmup:0,maxRelativeStdDev:0.05,maxRelativeDrift:0.03,settlingSigma:2});
const median=values=>{const s=[...values].sort((a,b)=>a-b),i=s.length>>1;return s.length%2?s[i]:(s[i-1]+s[i])/2};
function stats(values){
 const mean=values.reduce((a,b)=>a+b,0)/values.length;
 const stdDev=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/(values.length-1));
 const split=Math.floor(values.length/2);
 return {mean,stdDev,relativeStdDev:mean>0?stdDev/mean:stdDev===0?0:Infinity,relativeDrift:mean>0?Math.abs(median(values.slice(0,split))-median(values.slice(split)))/mean:0};
}
export function sampleStability(samples,maxSamples=samplePolicy.maxSamples){
 if(![10,25,35].includes(maxSamples))throw Error('Invalid sample cap');
 if(!Array.isArray(samples)||samples.length>maxSamples||samples.some(n=>!Number.isFinite(n)||n<0))throw Error('Invalid ordered latency samples');
 const count=samples.length;
 if(count<5||count%5) return {sampleCount:count,stable:false,stop:false,reason:'incomplete-group',retainedStart:0};
 const window=samples.slice(-10),summary=stats(window);
 const stable=summary.relativeStdDev<=samplePolicy.maxRelativeStdDev&&summary.relativeDrift<=samplePolicy.maxRelativeDrift;
 let retainedStart=0;
 // Exclude only a contiguous slow initial prefix, and only after at least two
 // stable retained groups. Later outliers remain in the reported distribution.
 if(stable&&count>=15){
  const threshold=summary.mean+Math.max(samplePolicy.settlingSigma*summary.stdDev,summary.mean*samplePolicy.maxRelativeDrift);
  while(retainedStart<count-10&&samples[retainedStart]>threshold)retainedStart++;
 }
 const retained=samples.slice(retainedStart);
 return {sampleCount:count,stable,stop:stable||count===maxSamples,reason:stable?'stable':count===maxSamples?'sample-cap':'collect-next-group',retainedStart,retainedCount:retained.length,window:summary,summary:stats(retained),medianNs:median(retained)};
}
