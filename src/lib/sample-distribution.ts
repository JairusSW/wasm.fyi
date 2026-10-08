export function sampleDistribution(values:number[]) {
 const sorted=values.filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);
 if(!sorted.length)return null;
 const quantile=(p:number)=>{const index=(sorted.length-1)*p,lo=Math.floor(index),hi=Math.ceil(index);return sorted[lo]+(sorted[hi]-sorted[lo])*(index-lo);};
 const mean=sorted.reduce((a,b)=>a+b,0)/sorted.length;
 const stdDev=sorted.length>1?Math.sqrt(sorted.reduce((sum,value)=>sum+(value-mean)**2,0)/(sorted.length-1)):null;
 const q1=quantile(.25),q3=quantile(.75),iqr=q3-q1;
 const whiskerLo=sorted.find(v=>v>=q1-1.5*iqr)!,whiskerHi=sorted.findLast(v=>v<=q3+1.5*iqr)!;
 return {count:sorted.length,mean,stdDev,median:quantile(.5),q1,q3,whiskerLo,whiskerHi,min:sorted[0],max:sorted.at(-1)!};
}
