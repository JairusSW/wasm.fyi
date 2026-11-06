import {expect,it,vi} from 'vitest';
vi.unmock('../view-data');
vi.mock('../data/features',()=>({FEATURE_ROWS:[],COMPAT:[{fams:[{id:'a'},{id:'b'},{id:'c'}]}]}));
vi.mock('../feature-values',async original=>({...await original<object>(),familyCohort:(_scope:unknown,_family:string,ids:string[])=>({values:ids.map((_,i)=>i+1)})}));
import './controller.svelte';
import {CFG,CB} from '../data/runtimes';
import {featureSpeed} from '../feature-leaders';
import {ui} from '../state.svelte';
it('indexes every planned table configuration before any live matrix fetch',()=>{
 for(const c of CFG)expect(CB[c.id],c.id).toBe(c);
});
it.each(['compile','steady'] as const)('includes the baked-only WasmEdge JIT configuration in %s cards',metric=>{
 const selected=['F','G','engine:wasmedge-jit'] as const;
 const result=featureSpeed(ui.scope,[...selected],metric);
 expect(result.ranked.map(row=>row.c.id)).toEqual([...selected]);
});
