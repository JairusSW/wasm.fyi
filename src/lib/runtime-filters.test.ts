import {describe,it,expect} from 'vitest';
import {filterRuntimes,parseRuntimeFilters,type RuntimeFilterRow,type RuntimeFilterRule} from './runtime-filters';
const rows:RuntimeFilterRow[]=Array.from({length:20},(_,i)=>({id:String(i),name:i<10?`wasmtime ${i}`:`wago ${i}`,values:{steady:i+1,pass:100-i,rss:20-i}}));
const rule=(metric:RuntimeFilterRule['metric'],top=100,limit:number|null=null)=>({metric,top,limit});
const apply=(rules:RuntimeFilterRule[],name='',rs=rows)=>[...filterRuntimes(rs,{name,rules})];
describe('runtime filters',()=>{
 it('rounds small percentiles up and ranks lower latency first',()=>{expect(apply([rule('steady',5)])).toEqual(['0']);expect(apply([rule('steady',10)])).toEqual(['0','1'])});
 it('keeps ties including a zero timing',()=>{expect(apply([rule('steady',5)],'',[{id:'a',name:'a',values:{steady:0}},{id:'b',name:'b',values:{steady:0}}])).toEqual(['a','b'])});
 it('ranks higher pass rates first and combines absolute limits',()=>{expect(apply([rule('pass',10,100)])).toEqual(['0']);expect(apply([rule('pass',100,98)])).toEqual(['0','1','2'])});
 it('intersects independent rankings rather than reranking filtered output',()=>{expect(apply([rule('steady',50),rule('rss',50)])).toEqual([])});
 it('matches names case-insensitively with comma-separated alternatives before ranking',()=>{expect(apply([rule('steady',10)],'WAGO')).toEqual(['10']);expect(apply([],'WAGO, Wasmtime')).toHaveLength(20);expect(apply([],'wasmtime 1')).toEqual(['1'])});
 it('excludes absent/nonfinite metrics only when a rule needs them',()=>{const rs=[{id:'a',name:'a',values:{}},{id:'b',name:'b',values:{steady:NaN}}];expect(apply([],'',rs)).toEqual(['a','b']);expect(apply([rule('steady')],'',rs)).toEqual([])});
 it('validates URL rules and preserves zero thresholds',()=>{const v={name:'wago',rules:[rule('steady',5,0)]};expect(parseRuntimeFilters(JSON.stringify(v))).toEqual(v);for(const r of [rule('pass',0),rule('pass',101),rule('pass',5,101),{metric:'wat',top:5,limit:null}])expect(parseRuntimeFilters(JSON.stringify({name:'',rules:[r]}))).toBeUndefined();expect(parseRuntimeFilters('{')).toBeUndefined()});
});
