import {expect,it} from 'vitest';
import {sampleDistribution} from './sample-distribution';
it('shows all five measured samples with sample standard deviation and interpolated quartiles',()=>{
 const stats=sampleDistribution([5,1,4,2,3])!;
 expect(stats).toMatchObject({count:5,median:3,mean:3,q1:2,q3:4,whiskerLo:1,whiskerHi:5});
 expect(stats.stdDev).toBeCloseTo(Math.sqrt(2.5));
});
it('keeps outliers in the plotted range and handles equal or single samples',()=>{
 expect(sampleDistribution([1,2,3,4,100])).toMatchObject({whiskerHi:4,max:100});
 expect(sampleDistribution([2,2,2,2,2])?.stdDev).toBe(0);
 expect(sampleDistribution([2])?.stdDev).toBeNull();
 expect(sampleDistribution([])).toBeNull();
});
