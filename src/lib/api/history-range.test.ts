import {expect,it} from 'vitest';
import {timelineRange} from './history-range';
it('resets shortened windows before chart consumers read the new dates',()=>{
 expect(timelineRange(0,28,28,true)).toEqual({from:0,to:27});
 expect(timelineRange(25,28,2,true)).toEqual({from:0,to:1});
 expect(timelineRange(25,28,0,true)).toEqual({from:0,to:0});
});
it('preserves a manually selected delta range when the window has not changed',()=>{
 expect(timelineRange(3,8,29,false)).toEqual({from:3,to:8});
 expect(timelineRange(3,28,28,false)).toEqual({from:3,to:27});
});
