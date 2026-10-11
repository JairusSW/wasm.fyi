import {expect,it} from 'vitest';
import {heatCorrectness} from './heat';
it('reserves green for a full pass and penalizes even one failure',()=>{
 expect(heatCorrectness(45,45)).toContain('165');
 expect(heatCorrectness(44,45)).not.toBe(heatCorrectness(45,45));
 expect(heatCorrectness(44,45)).toContain('77.6');
 expect(heatCorrectness(40,45)).toContain('30.0');
 expect(heatCorrectness(0,0)).toBe('transparent');
});
