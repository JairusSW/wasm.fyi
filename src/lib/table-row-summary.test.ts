import {expect,it} from 'vitest';
import {heatFields,heatField} from './heat';
import {rankRows} from './tip';
it('keeps tied ranks, missing cells and a stable best engine',()=>{
 const values=[20,null,10,10,40];
 expect(rankRows(values,['slow','absent','first tie','second tie','last'],v=>`${v} ns`)).toEqual([
  [['place','3rd of 4'],['fastest','first tie · 10 ns']],
  [['fastest','first tie · 10 ns']],
  [['place','1st of 4'],['fastest','first tie · 10 ns']],
  [['place','1st of 4'],['fastest','first tie · 10 ns']],
  [['place','4th of 4'],['fastest','first tie · 10 ns']]
 ]);
});
it('uses one consistent field scale for the whole row',()=>{
 const values=[1,4,16,null];const colors=heatFields(values);
 expect(colors[0]).toContain('160');expect(colors[1]).toBe('transparent');expect(colors[2]).toContain('28');expect(colors[3]).toBe('transparent');
 expect(values.map((_,i)=>heatField(values,i))).toEqual(colors);
 expect(heatFields([null,7])).toEqual(['transparent','transparent']);
});
